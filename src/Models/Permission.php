<?php

declare(strict_types=1);

namespace App\Models;

class Permission extends BaseModel
{
    protected string $table = 'permissions';

    // Permission name constants for type safety
    public const ADMINISTRATOR = 'administrator';
    public const MANAGE_CHANNELS = 'manage_channels';
    public const MANAGE_ROLES = 'manage_roles';
    public const KICK_MEMBERS = 'kick_members';
    public const BAN_MEMBERS = 'ban_members';
    public const SEND_MESSAGES = 'send_messages';
    public const MANAGE_MESSAGES = 'manage_messages';
    public const EMBED_LINKS = 'embed_links';
    public const ATTACH_FILES = 'attach_files';
    public const READ_HISTORY = 'read_history';
    public const MENTION_EVERYONE = 'mention_everyone';
    public const USE_VOICE = 'use_voice';
    public const SPEAK = 'speak';
    public const MUTE_MEMBERS = 'mute_members';
    public const DEAFEN_MEMBERS = 'deafen_members';
    public const MOVE_MEMBERS = 'move_members';
    public const MANAGE_SOUNDS = 'manage_sounds';

    /**
     * Get all permissions grouped by category
     */
    public function getAllGrouped(): array
    {
        $permissions = $this->db->fetchAll(
            "SELECT * FROM {$this->table} ORDER BY category, id"
        );

        $grouped = [];
        foreach ($permissions as $perm) {
            $grouped[$perm['category']][] = $perm;
        }

        return $grouped;
    }

    /**
     * Get all permissions as a flat array
     */
    public function getAll(): array
    {
        return $this->db->fetchAll(
            "SELECT * FROM {$this->table} ORDER BY id"
        );
    }

    /**
     * Get permission by name
     */
    public function getByName(string $name): ?array
    {
        return $this->db->fetchOne(
            "SELECT * FROM {$this->table} WHERE name = ?",
            [$name]
        );
    }

    /**
     * Get permission IDs by names
     */
    public function getIdsByNames(array $names): array
    {
        if (empty($names)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($names), '?'));
        $result = $this->db->fetchAll(
            "SELECT id FROM {$this->table} WHERE name IN ($placeholders)",
            $names
        );

        return array_column($result, 'id');
    }

    /**
     * Create a new permission (for future extensions)
     */
    public function createPermission(string $name, string $description, string $category = 'general'): int
    {
        return $this->create([
            'name' => $name,
            'description' => $description,
            'category' => $category
        ]);
    }
}
