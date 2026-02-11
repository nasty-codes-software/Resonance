<?php

declare(strict_types=1);

namespace App\Models;

class Role extends BaseModel
{
    protected string $table = 'roles';

    public function getAllOrdered(): array
    {
        return $this->db->fetchAll(
            "SELECT * FROM {$this->table} ORDER BY position DESC"
        );
    }

    /**
     * Get all roles with their permissions
     */
    public function getAllWithPermissions(): array
    {
        $roles = $this->getAllOrdered();
        
        foreach ($roles as &$role) {
            $role['permissions'] = $this->getRolePermissions($role['id']);
        }
        
        return $roles;
    }

    public function getDefaultRole(): ?array
    {
        return $this->db->fetchOne(
            "SELECT * FROM {$this->table} WHERE is_default = 1"
        );
    }

    /**
     * Get permissions for a specific role
     */
    public function getRolePermissions(int $roleId): array
    {
        return $this->db->fetchAll(
            "SELECT p.* FROM permissions p
             JOIN role_permissions rp ON p.id = rp.permission_id
             WHERE rp.role_id = ?
             ORDER BY p.category, p.id",
            [$roleId]
        );
    }

    /**
     * Get permission names for a role
     */
    public function getRolePermissionNames(int $roleId): array
    {
        $permissions = $this->getRolePermissions($roleId);
        return array_column($permissions, 'name');
    }

    public function getUserRoles(int $userId): array
    {
        return $this->db->fetchAll(
            "SELECT r.* FROM {$this->table} r
             JOIN user_roles ur ON r.id = ur.role_id
             WHERE ur.user_id = ?
             ORDER BY r.position DESC",
            [$userId]
        );
    }

    public function getHighestRole(int $userId): ?array
    {
        return $this->db->fetchOne(
            "SELECT r.* FROM {$this->table} r
             JOIN user_roles ur ON r.id = ur.role_id
             WHERE ur.user_id = ?
             ORDER BY r.position DESC
             LIMIT 1",
            [$userId]
        );
    }

    public function assignRole(int $userId, int $roleId): bool
    {
        try {
            $this->db->query(
                "INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
                [$userId, $roleId]
            );
            return true;
        } catch (\Exception $e) {
            return false;
        }
    }

    public function removeRole(int $userId, int $roleId): bool
    {
        return $this->db->delete('user_roles', 'user_id = ? AND role_id = ?', [$userId, $roleId]) > 0;
    }

    /**
     * Get all permission names a user has through their roles
     */
    public function getUserPermissions(int $userId): array
    {
        return $this->db->fetchAll(
            "SELECT DISTINCT p.name FROM permissions p
             JOIN role_permissions rp ON p.id = rp.permission_id
             JOIN user_roles ur ON rp.role_id = ur.role_id
             WHERE ur.user_id = ?",
            [$userId]
        );
    }

    /**
     * Get user permission names as a simple array
     */
    public function getUserPermissionNames(int $userId): array
    {
        $permissions = $this->getUserPermissions($userId);
        return array_column($permissions, 'name');
    }

    /**
     * Check if user has a specific permission
     */
    public function hasPermission(int $userId, string $permission): bool
    {
        $permissions = $this->getUserPermissionNames($userId);
        
        // Administrator has all permissions
        if (in_array(Permission::ADMINISTRATOR, $permissions)) {
            return true;
        }
        
        return in_array($permission, $permissions);
    }

    /**
     * Check if user has any of the given permissions
     */
    public function hasAnyPermission(int $userId, array $permissions): bool
    {
        $userPermissions = $this->getUserPermissionNames($userId);
        
        // Administrator has all permissions
        if (in_array(Permission::ADMINISTRATOR, $userPermissions)) {
            return true;
        }
        
        foreach ($permissions as $permission) {
            if (in_array($permission, $userPermissions)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Create a new role
     */
    public function createRole(string $name, string $color, array $permissionNames = []): int
    {
        $maxPosition = $this->db->fetchOne(
            "SELECT MAX(position) as max_pos FROM {$this->table} WHERE is_default = 0"
        );
        $position = ($maxPosition['max_pos'] ?? 0) + 1;

        $roleId = $this->create([
            'name' => $name,
            'color' => $color,
            'position' => $position,
            'is_default' => 0
        ]);

        // Assign permissions to role
        if (!empty($permissionNames)) {
            $this->setRolePermissions($roleId, $permissionNames);
        }

        return $roleId;
    }

    /**
     * Set permissions for a role (replaces existing)
     */
    public function setRolePermissions(int $roleId, array $permissionNames): void
    {
        // Remove existing permissions
        $this->db->delete('role_permissions', 'role_id = ?', [$roleId]);

        if (empty($permissionNames)) {
            return;
        }

        // Get permission IDs
        $permModel = new Permission($this->db);
        $permissionIds = $permModel->getIdsByNames($permissionNames);

        // Insert new permissions
        foreach ($permissionIds as $permId) {
            $this->db->insert('role_permissions', [
                'role_id' => $roleId,
                'permission_id' => $permId
            ]);
        }
    }

    /**
     * Add a single permission to a role
     */
    public function addRolePermission(int $roleId, string $permissionName): bool
    {
        $permModel = new Permission($this->db);
        $permission = $permModel->getByName($permissionName);
        
        if (!$permission) {
            return false;
        }

        try {
            $this->db->query(
                "INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
                [$roleId, $permission['id']]
            );
            return true;
        } catch (\Exception $e) {
            return false;
        }
    }

    /**
     * Remove a single permission from a role
     */
    public function removeRolePermission(int $roleId, string $permissionName): bool
    {
        $permModel = new Permission($this->db);
        $permission = $permModel->getByName($permissionName);
        
        if (!$permission) {
            return false;
        }

        return $this->db->delete(
            'role_permissions', 
            'role_id = ? AND permission_id = ?', 
            [$roleId, $permission['id']]
        ) > 0;
    }

    public function assignDefaultRole(int $userId): void
    {
        $defaultRole = $this->getDefaultRole();
        if ($defaultRole) {
            $this->assignRole($userId, $defaultRole['id']);
        }
    }
}
