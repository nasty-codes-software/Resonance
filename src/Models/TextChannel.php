<?php

declare(strict_types=1);

namespace App\Models;

class TextChannel extends BaseModel
{
    protected string $table = 'text_channels';

    /**
     * Get all public (server) channels ordered by category and position
     */
    public function getAllOrdered(): array
    {
        return $this->db->fetchAll(
            "SELECT tc.*, u.username as creator_name 
             FROM {$this->table} tc 
             LEFT JOIN users u ON tc.created_by = u.id 
             WHERE tc.type = 'public'
             ORDER BY tc.category_id ASC, tc.position ASC"
        );
    }

    public function getByCategory(?int $categoryId): array
    {
        if ($categoryId === null) {
            return $this->db->fetchAll(
                "SELECT tc.*, u.username as creator_name 
                 FROM {$this->table} tc 
                 LEFT JOIN users u ON tc.created_by = u.id 
                 WHERE tc.category_id IS NULL AND tc.type = 'public'
                 ORDER BY tc.position ASC"
            );
        }
        return $this->db->fetchAll(
            "SELECT tc.*, u.username as creator_name 
             FROM {$this->table} tc 
             LEFT JOIN users u ON tc.created_by = u.id 
             WHERE tc.category_id = ? AND tc.type = 'public'
             ORDER BY tc.position ASC",
            [$categoryId]
        );
    }

    public function createChannel(string $name, int $createdBy, ?string $description = null, ?int $categoryId = null, string $type = 'public'): int
    {
        $maxPosition = $this->db->fetchOne(
            "SELECT MAX(position) as max_pos FROM {$this->table}"
        );
        
        return $this->create([
            'name' => $name,
            'description' => $description,
            'created_by' => $createdBy,
            'category_id' => $categoryId,
            'type' => $type,
            'position' => ($maxPosition['max_pos'] ?? 0) + 1
        ]);
    }

    /**
     * Create a DM channel between two users and register participants
     */
    public function createDmChannel(int $user1Id, int $user2Id): int
    {
        $name = 'dm-' . min($user1Id, $user2Id) . '-' . max($user1Id, $user2Id);
        
        $channelId = $this->create([
            'name' => $name,
            'description' => null,
            'created_by' => $user1Id,
            'category_id' => null,
            'type' => 'dm',
            'position' => 0
        ]);

        // Add both users as participants
        $this->db->insert('channel_participants', [
            'channel_id' => $channelId,
            'channel_type' => 'text',
            'user_id' => $user1Id
        ]);
        $this->db->insert('channel_participants', [
            'channel_id' => $channelId,
            'channel_type' => 'text',
            'user_id' => $user2Id
        ]);

        return $channelId;
    }

    /**
     * Find an existing DM channel between two users
     */
    public function findDmChannel(int $user1Id, int $user2Id): ?array
    {
        return $this->db->fetchOne(
            "SELECT tc.* FROM {$this->table} tc
             JOIN channel_participants cp1 ON tc.id = cp1.channel_id AND cp1.channel_type = 'text' AND cp1.user_id = ?
             JOIN channel_participants cp2 ON tc.id = cp2.channel_id AND cp2.channel_type = 'text' AND cp2.user_id = ?
             WHERE tc.type = 'dm'
             LIMIT 1",
            [$user1Id, $user2Id]
        );
    }

    /**
     * Get or create a DM channel between two users
     */
    public function getOrCreateDmChannel(int $user1Id, int $user2Id): array
    {
        $channel = $this->findDmChannel($user1Id, $user2Id);
        if ($channel) {
            return $channel;
        }
        $channelId = $this->createDmChannel($user1Id, $user2Id);
        return $this->find($channelId);
    }

    /**
     * Get all DM channels for a user with the other participant's info
     */
    public function getUserDmChannels(int $userId): array
    {
        return $this->db->fetchAll(
            "SELECT tc.*, u.id as other_user_id, u.username as other_username, 
                    u.display_name as other_display_name, u.avatar as other_avatar, u.status as other_status
             FROM {$this->table} tc
             JOIN channel_participants cp1 ON tc.id = cp1.channel_id AND cp1.channel_type = 'text' AND cp1.user_id = ?
             JOIN channel_participants cp2 ON tc.id = cp2.channel_id AND cp2.channel_type = 'text' AND cp2.user_id != ?
             JOIN users u ON cp2.user_id = u.id
             WHERE tc.type = 'dm'
             ORDER BY tc.updated_at DESC",
            [$userId, $userId]
        );
    }

    /**
     * Check if a user is a participant in a DM channel
     */
    public function isChannelParticipant(int $channelId, int $userId): bool
    {
        $result = $this->db->fetchOne(
            "SELECT id FROM channel_participants 
             WHERE channel_id = ? AND channel_type = 'text' AND user_id = ?",
            [$channelId, $userId]
        );
        return $result !== null;
    }

    public function findByName(string $name): ?array
    {
        return $this->findBy('name', $name);
    }
}
