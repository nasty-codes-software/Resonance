<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Core\Request;
use App\Core\Session;
use App\Core\Database;
use App\Models\User;
use App\Models\Role;
use App\Models\Permission;
use App\Models\InviteCode;

class UserController extends BaseController
{
    private User $userModel;
    private Role $roleModel;
    private InviteCode $inviteCodeModel;

    public function __construct(Database $db)
    {
        parent::__construct($db);
        $this->userModel = new User($db);
        $this->roleModel = new Role($db);
        $this->inviteCodeModel = new InviteCode($db);
    }

    public function profile(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = Session::getUserId();
        $user = $this->userModel->getUserProfile($userId);

        if (!$user) {
            $this->json(['error' => 'User not found'], 404);
            return;
        }

        $this->json(['user' => $user]);
    }

    public function getProfile(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = (int)$request->param('id');
        $user = $this->userModel->getUserProfile($userId);

        if (!$user) {
            $this->json(['error' => 'User not found'], 404);
            return;
        }

        $this->json(['user' => $user]);
    }

    public function updateAccount(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = Session::getUserId();
        $user = $this->userModel->find($userId);

        if (!$user) {
            $this->json(['error' => 'User not found'], 404);
            return;
        }

        $data = $request->json();
        $username = trim($data['username'] ?? $user['username']);
        $email = trim($data['email'] ?? $user['email']);
        $currentPassword = $data['current_password'] ?? '';
        $newPassword = $data['new_password'] ?? '';

        // Validate username
        if (strlen($username) < 3 || strlen($username) > 32) {
            $this->json(['error' => 'Username must be 3-32 characters'], 400);
            return;
        }

        // Check if username is taken by another user
        $existingUser = $this->userModel->findByUsername($username);
        if ($existingUser && $existingUser['id'] !== $userId) {
            $this->json(['error' => 'Username is already taken'], 400);
            return;
        }

        // Check if email is taken by another user
        if ($email) {
            $existingEmail = $this->userModel->findByEmail($email);
            if ($existingEmail && $existingEmail['id'] !== $userId) {
                $this->json(['error' => 'Email is already in use'], 400);
                return;
            }
        }

        $updateData = ['username' => $username];
        if ($email) {
            $updateData['email'] = $email;
        }

        // Handle password change
        if (!empty($currentPassword) && !empty($newPassword)) {
            if (!password_verify($currentPassword, $user['password'])) {
                $this->json(['error' => 'Current password is incorrect'], 400);
                return;
            }

            if (strlen($newPassword) < 6) {
                $this->json(['error' => 'New password must be at least 6 characters'], 400);
                return;
            }

            $updateData['password'] = password_hash($newPassword, PASSWORD_DEFAULT);
        }

        $this->userModel->update($userId, $updateData);
        Session::updateUser(['username' => $username, 'email' => $email]);
        
        $this->json(['success' => true]);
    }

    public function updateProfile(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = Session::getUserId();
        $data = $request->json();

        $updateData = [];
        
        if (isset($data['display_name'])) {
            $updateData['display_name'] = trim($data['display_name']);
        }
        if (isset($data['bio'])) {
            $updateData['bio'] = substr(trim($data['bio']), 0, 500);
        }
        if (isset($data['custom_status'])) {
            $updateData['custom_status'] = substr(trim($data['custom_status']), 0, 128);
        }
        if (isset($data['status']) && in_array($data['status'], ['online', 'idle', 'dnd', 'invisible'])) {
            $updateData['status'] = $data['status'];
        }
        if (isset($data['banner_color']) && preg_match('/^#[0-9A-Fa-f]{6}$/', $data['banner_color'])) {
            $updateData['banner_color'] = $data['banner_color'];
        }
        if (isset($data['voice_sensitivity'])) {
            $updateData['voice_sensitivity'] = max(0, min(100, (int)$data['voice_sensitivity']));
        }

        if (!empty($updateData)) {
            $this->userModel->update($userId, $updateData);
            Session::updateUser($updateData);
        }

        $this->json(['success' => true]);
    }

    public function uploadAvatar(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = Session::getUserId();
        
        if (!isset($_FILES['avatar']) || $_FILES['avatar']['error'] !== UPLOAD_ERR_OK) {
            $this->json(['error' => 'No file uploaded'], 400);
            return;
        }

        $file = $_FILES['avatar'];
        $allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        
        if (!in_array($file['type'], $allowedTypes)) {
            $this->json(['error' => 'Invalid file type. Use JPG, PNG, GIF or WebP'], 400);
            return;
        }

        if ($file['size'] > 8 * 1024 * 1024) {
            $this->json(['error' => 'File too large. Max 8MB'], 400);
            return;
        }

        $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
        $filename = 'avatar_' . $userId . '_' . time() . '.' . $ext;
        $uploadPath = BASE_PATH . '/public/uploads/avatars/';
        
        if (!is_dir($uploadPath)) {
            mkdir($uploadPath, 0755, true);
        }

        if (move_uploaded_file($file['tmp_name'], $uploadPath . $filename)) {
            $avatarUrl = '/uploads/avatars/' . $filename;
            $this->userModel->update($userId, ['avatar' => $avatarUrl]);
            Session::updateUser(['avatar' => $avatarUrl]);
            $this->json(['success' => true, 'avatar' => $avatarUrl]);
        } else {
            $this->json(['error' => 'Failed to save file'], 500);
        }
    }

    public function deleteAvatar(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = Session::getUserId();
        $this->userModel->update($userId, ['avatar' => null]);
        Session::updateUser(['avatar' => null]);
        
        $this->json(['success' => true]);
    }

    public function uploadBanner(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = Session::getUserId();
        
        if (!isset($_FILES['banner']) || $_FILES['banner']['error'] !== UPLOAD_ERR_OK) {
            $this->json(['error' => 'No file uploaded'], 400);
            return;
        }

        $file = $_FILES['banner'];
        $allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        
        if (!in_array($file['type'], $allowedTypes)) {
            $this->json(['error' => 'Invalid file type'], 400);
            return;
        }

        if ($file['size'] > 10 * 1024 * 1024) {
            $this->json(['error' => 'File too large. Max 10MB'], 400);
            return;
        }

        $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
        $filename = 'banner_' . $userId . '_' . time() . '.' . $ext;
        $uploadPath = BASE_PATH . '/public/uploads/banners/';
        
        if (!is_dir($uploadPath)) {
            mkdir($uploadPath, 0755, true);
        }

        if (move_uploaded_file($file['tmp_name'], $uploadPath . $filename)) {
            $bannerUrl = '/uploads/banners/' . $filename;
            $this->userModel->update($userId, ['banner' => $bannerUrl]);
            Session::updateUser(['banner' => $bannerUrl]);
            $this->json(['success' => true, 'banner' => $bannerUrl]);
        } else {
            $this->json(['error' => 'Failed to save file'], 500);
        }
    }

    public function deleteBanner(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = Session::getUserId();
        $this->userModel->update($userId, ['banner' => null]);
        Session::updateUser(['banner' => null]);
        
        $this->json(['success' => true]);
    }

    // ========================
    // Admin: User Management
    // ========================

    /**
     * Delete a user (admin only)
     */
    public function deleteUser(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $currentUserId = Session::getUserId();
        $targetUserId = (int)$request->param('id');

        // Check admin permission
        if (!$this->roleModel->hasPermission($currentUserId, Permission::ADMINISTRATOR)) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        // Cannot delete yourself
        if ($currentUserId === $targetUserId) {
            $this->json(['error' => 'Cannot delete your own account'], 400);
            return;
        }

        // Check if target user exists
        $targetUser = $this->userModel->find($targetUserId);
        if (!$targetUser) {
            $this->json(['error' => 'User not found'], 404);
            return;
        }

        // Cannot delete other admins
        if ($this->roleModel->hasPermission($targetUserId, Permission::ADMINISTRATOR)) {
            $this->json(['error' => 'Cannot delete other administrators'], 403);
            return;
        }

        // Delete the user
        if ($this->userModel->deleteUser($targetUserId)) {
            $this->json(['success' => true, 'message' => 'User deleted successfully']);
        } else {
            $this->json(['error' => 'Failed to delete user'], 500);
        }
    }

    /**
     * Get all users (admin only)
     */
    public function getAllUsers(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $currentUserId = Session::getUserId();
        
        if (!$this->roleModel->hasPermission($currentUserId, Permission::ADMINISTRATOR)) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $users = $this->userModel->getAllWithRoles();
        $this->json(['users' => $users]);
    }

    // ========================
    // Admin: Invite Codes
    // ========================

    /**
     * Get all invite codes (admin only)
     */
    public function getInviteCodes(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $currentUserId = Session::getUserId();
        
        if (!$this->roleModel->hasPermission($currentUserId, Permission::ADMINISTRATOR)) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $codes = $this->inviteCodeModel->getAllWithCreator();
        $this->json(['codes' => $codes]);
    }

    /**
     * Create a new invite code (admin only)
     */
    public function createInviteCode(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $currentUserId = Session::getUserId();
        
        if (!$this->roleModel->hasPermission($currentUserId, Permission::ADMINISTRATOR)) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $data = $request->json();
        $maxUses = isset($data['max_uses']) ? (int)$data['max_uses'] : null;
        $expiresIn = isset($data['expires_in']) ? (int)$data['expires_in'] : null; // hours

        $expiresAt = null;
        if ($expiresIn && $expiresIn > 0) {
            $expiresAt = new \DateTime();
            $expiresAt->add(new \DateInterval("PT{$expiresIn}H"));
        }

        $code = $this->inviteCodeModel->createCode($currentUserId, $maxUses ?: null, $expiresAt);
        
        $this->json(['success' => true, 'code' => $code]);
    }

    /**
     * Revoke (delete) an invite code (admin only)
     */
    public function revokeInviteCode(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $currentUserId = Session::getUserId();
        
        if (!$this->roleModel->hasPermission($currentUserId, Permission::ADMINISTRATOR)) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $codeId = (int)$request->param('id');
        
        if ($this->inviteCodeModel->revoke($codeId)) {
            $this->json(['success' => true]);
        } else {
            $this->json(['error' => 'Invite code not found'], 404);
        }
    }
}
