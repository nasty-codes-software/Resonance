<?php

declare(strict_types=1);

namespace App\Models;

class User extends BaseModel
{
    protected string $table = 'users';

    public function findByEmail(string $email): ?array
    {
        return $this->findBy('email', $email);
    }

    public function findByUsername(string $username): ?array
    {
        return $this->findBy('username', $username);
    }

    public function createUser(string $username, string $email, string $password): int
    {
        $id = $this->create([
            'username' => $username,
            'display_name' => $username,
            'email' => $email,
            'password' => password_hash($password, PASSWORD_DEFAULT),
            'status' => 'offline'
        ]);
        
        // Assign default role
        $roleModel = new Role($this->db);
        $roleModel->assignDefaultRole($id);
        
        return $id;
    }

    public function verifyPassword(array $user, string $password): bool
    {
        return password_verify($password, $user['password']);
    }

    public function updateStatus(int $userId, string $status): int
    {
        return $this->update($userId, ['status' => $status]);
    }

    public function setOnline(int $userId): int
    {
        return $this->updateStatus($userId, 'online');
    }

    public function setOffline(int $userId): int
    {
        return $this->updateStatus($userId, 'offline');
    }

    public function getOnlineUsers(): array
    {
        return $this->db->fetchAll(
            "SELECT u.id, u.username, u.display_name, u.avatar, u.status, u.custom_status,
                    (SELECT r.color FROM roles r 
                     JOIN user_roles ur ON r.id = ur.role_id 
                     WHERE ur.user_id = u.id 
                     ORDER BY r.position DESC LIMIT 1) as role_color
             FROM {$this->table} u 
             WHERE u.status != 'offline' 
             ORDER BY u.username"
        );
    }

    public function getAllUsersWithStatus(): array
    {
        return $this->db->fetchAll(
            "SELECT u.id, u.username, u.display_name, u.avatar, u.status, u.custom_status,
                    (SELECT r.color FROM roles r 
                     JOIN user_roles ur ON r.id = ur.role_id 
                     WHERE ur.user_id = u.id 
                     ORDER BY r.position DESC LIMIT 1) as role_color
             FROM {$this->table} u 
             ORDER BY CASE WHEN u.status = 'offline' THEN 1 ELSE 0 END, u.username"
        );
    }

    public function getAllUsers(): array
    {
        return $this->db->fetchAll(
            "SELECT u.id, u.username, u.display_name, u.email, u.avatar, u.status, u.created_at,
                    (SELECT r.name FROM roles r 
                     JOIN user_roles ur ON r.id = ur.role_id 
                     WHERE ur.user_id = u.id 
                     ORDER BY r.position DESC LIMIT 1) as role_name,
                    (SELECT r.color FROM roles r 
                     JOIN user_roles ur ON r.id = ur.role_id 
                     WHERE ur.user_id = u.id 
                     ORDER BY r.position DESC LIMIT 1) as role_color
             FROM {$this->table} u 
             ORDER BY u.username"
        );
    }

    public function getAllWithRoles(): array
    {
        $users = $this->getAllUsers();
        $roleModel = new Role($this->db);
        
        foreach ($users as &$user) {
            $user['roles'] = $roleModel->getUserRoles((int)$user['id']);
        }
        
        return $users;
    }

    public function getUserProfile(int $userId): ?array
    {
        $user = $this->db->fetchOne(
            "SELECT u.id, u.username, u.display_name, u.email, u.avatar, u.banner, 
                    u.banner_color, u.bio, u.custom_status, u.status, u.voice_sensitivity, u.created_at
             FROM {$this->table} u 
             WHERE u.id = ?",
            [$userId]
        );
        
        if ($user) {
            $roleModel = new Role($this->db);
            $user['roles'] = $roleModel->getUserRoles($userId);
        }
        
        return $user;
    }

    public function updateProfile(int $userId, array $data): bool
    {
        $allowed = ['display_name', 'avatar', 'banner', 'banner_color', 'bio', 'custom_status', 'voice_sensitivity'];
        $updateData = array_intersect_key($data, array_flip($allowed));
        
        if (empty($updateData)) {
            return false;
        }
        
        return $this->update($userId, $updateData) > 0;
    }

    public function toPublic(array $user): array
    {
        unset($user['password']);
        return $user;
    }

    /**
     * Delete a user and all associated data
     * Foreign keys with ON DELETE CASCADE will handle related records
     */
    public function deleteUser(int $userId): bool
    {
        // Get user to clean up files
        $user = $this->find($userId);
        if (!$user) {
            return false;
        }

        // Delete avatar file if exists
        if (!empty($user['avatar'])) {
            $avatarPath = BASE_PATH . '/public' . $user['avatar'];
            if (file_exists($avatarPath)) {
                @unlink($avatarPath);
            }
        }

        // Delete banner file if exists
        if (!empty($user['banner'])) {
            $bannerPath = BASE_PATH . '/public' . $user['banner'];
            if (file_exists($bannerPath)) {
                @unlink($bannerPath);
            }
        }

        // Delete user record (cascades to related tables)
        return $this->delete($userId) > 0;
    }
}
