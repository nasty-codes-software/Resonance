<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Core\Request;
use App\Core\Session;
use App\Core\Database;
use App\Models\Role;
use App\Models\User;
use App\Models\Permission;

class RoleController extends BaseController
{
    private Role $roleModel;
    private User $userModel;

    public function __construct(Database $db)
    {
        parent::__construct($db);
        $this->roleModel = new Role($db);
        $this->userModel = new User($db);
    }

    public function list(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $roles = $this->roleModel->getAllOrdered();
        
        // Add permissions array to each role
        foreach ($roles as &$role) {
            $role['permissions'] = $this->roleModel->getRolePermissionNames($role['id']);
        }
        
        $this->json(['roles' => $roles]);
    }

    public function create(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        // Check if user has permission to manage roles
        if (!$this->roleModel->hasPermission(Session::getUserId(), Permission::MANAGE_ROLES) && !Session::isAdmin()) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $data = $request->json();
        $name = trim($data['name'] ?? '');
        $color = $data['color'] ?? '#5865f2';
        $permissions = $data['permissions'] ?? [];

        if (empty($name)) {
            $this->json(['error' => 'Role name is required'], 400);
            return;
        }

        if (strlen($name) > 50) {
            $this->json(['error' => 'Role name is too long'], 400);
            return;
        }

        $roleId = $this->roleModel->createRole($name, $color, $permissions);
        $role = $this->roleModel->find($roleId);
        $role['permissions'] = $this->roleModel->getRolePermissionNames($roleId);

        $this->json([
            'success' => true,
            'role' => $role
        ]);
    }

    public function update(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        if (!$this->roleModel->hasPermission(Session::getUserId(), Permission::MANAGE_ROLES) && !Session::isAdmin()) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $id = (int)$request->param('id');
        $role = $this->roleModel->find($id);

        if (!$role) {
            $this->json(['error' => 'Role not found'], 404);
            return;
        }

        // Can't edit default role name
        if ($role['is_default'] && isset($data['name'])) {
            $this->json(['error' => 'Cannot rename default role'], 400);
            return;
        }

        $data = $request->json();
        $updateData = [];

        if (isset($data['name'])) {
            $name = trim($data['name']);
            if (!empty($name) && strlen($name) <= 50) {
                $updateData['name'] = $name;
            }
        }

        if (isset($data['color'])) {
            $updateData['color'] = $data['color'];
        }

        if (!empty($updateData)) {
            $this->roleModel->update($id, $updateData);
        }

        // Update permissions if provided (as array of permission names)
        if (isset($data['permissions']) && is_array($data['permissions'])) {
            $this->roleModel->setRolePermissions($id, $data['permissions']);
        }

        $role = $this->roleModel->find($id);
        $role['permissions'] = $this->roleModel->getRolePermissionNames($id);
        $this->json(['success' => true, 'role' => $role]);
    }

    public function delete(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        if (!$this->roleModel->hasPermission(Session::getUserId(), Permission::MANAGE_ROLES) && !Session::isAdmin()) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $id = (int)$request->param('id');
        $role = $this->roleModel->find($id);

        if (!$role) {
            $this->json(['error' => 'Role not found'], 404);
            return;
        }

        if ($role['is_default']) {
            $this->json(['error' => 'Cannot delete default role'], 400);
            return;
        }

        // Delete all user role assignments first
        $this->db->delete('user_roles', 'role_id = ?', [$id]);
        // Delete role permissions
        $this->db->delete('role_permissions', 'role_id = ?', [$id]);
        $this->roleModel->delete($id);

        $this->json(['success' => true]);
    }

    public function getMembers(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $users = $this->userModel->getAllWithRoles();
        $this->json(['members' => $users]);
    }

    public function getUserRoles(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = (int)$request->param('id');
        $roles = $this->roleModel->getUserRoles($userId);
        
        $this->json(['roles' => $roles]);
    }

    public function assignRole(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        if (!$this->roleModel->hasPermission(Session::getUserId(), Permission::MANAGE_ROLES) && !Session::isAdmin()) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $data = $request->json();
        $userId = (int)($data['user_id'] ?? 0);
        $roleId = (int)($data['role_id'] ?? 0);

        if (!$userId || !$roleId) {
            $this->json(['error' => 'User ID and Role ID are required'], 400);
            return;
        }

        $user = $this->userModel->find($userId);
        $role = $this->roleModel->find($roleId);

        if (!$user || !$role) {
            $this->json(['error' => 'User or Role not found'], 404);
            return;
        }

        $this->roleModel->assignRole($userId, $roleId);
        $this->json(['success' => true]);
    }

    public function removeRole(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        if (!$this->roleModel->hasPermission(Session::getUserId(), Permission::MANAGE_ROLES) && !Session::isAdmin()) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $data = $request->json();
        $userId = (int)($data['user_id'] ?? 0);
        $roleId = (int)($data['role_id'] ?? 0);

        if (!$userId || !$roleId) {
            $this->json(['error' => 'User ID and Role ID are required'], 400);
            return;
        }

        $role = $this->roleModel->find($roleId);
        
        // Can't remove default role
        if ($role && $role['is_default']) {
            $this->json(['error' => 'Cannot remove default role'], 400);
            return;
        }

        $this->roleModel->removeRole($userId, $roleId);
        $this->json(['success' => true]);
    }

    public function updateMemberRoles(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        if (!$this->roleModel->hasPermission(Session::getUserId(), Permission::MANAGE_ROLES) && !Session::isAdmin()) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $userId = (int)$request->param('id');
        $data = $request->json();
        $roleIds = $data['roles'] ?? [];

        $user = $this->userModel->find($userId);
        if (!$user) {
            $this->json(['error' => 'User not found'], 404);
            return;
        }

        // Get current roles
        $currentRoles = $this->roleModel->getUserRoles($userId);
        $currentRoleIds = array_column($currentRoles, 'id');

        // Get default role (always keep it)
        $defaultRole = $this->roleModel->getDefaultRole();
        $defaultRoleId = $defaultRole ? $defaultRole['id'] : null;

        // Roles to add
        foreach ($roleIds as $roleId) {
            if (!in_array($roleId, $currentRoleIds)) {
                $this->roleModel->assignRole($userId, (int)$roleId);
            }
        }

        // Roles to remove (except default)
        foreach ($currentRoleIds as $currentRoleId) {
            if (!in_array($currentRoleId, $roleIds) && $currentRoleId != $defaultRoleId) {
                $this->roleModel->removeRole($userId, (int)$currentRoleId);
            }
        }

        $this->json(['success' => true]);
    }
}
