<?php

declare(strict_types=1);

namespace App\Models;

class VoiceChannel extends BaseModel
{
    protected string $table = 'voice_channels';

    /**
     * Get all public (server) voice channels ordered
     */
    public function getAllOrdered(): array
    {
        return $this->db->fetchAll(
            "SELECT vc.*, u.username as creator_name 
             FROM {$this->table} vc 
             LEFT JOIN users u ON vc.created_by = u.id 
             WHERE vc.type = 'public'
             ORDER BY vc.category_id ASC, vc.position ASC"
        );
    }

    public function getByCategory(?int $categoryId): array
    {
        if ($categoryId === null) {
            return $this->db->fetchAll(
                "SELECT vc.*, u.username as creator_name 
                 FROM {$this->table} vc 
                 LEFT JOIN users u ON vc.created_by = u.id 
                 WHERE vc.category_id IS NULL AND vc.type = 'public'
                 ORDER BY vc.position ASC"
            );
        }
        return $this->db->fetchAll(
            "SELECT vc.*, u.username as creator_name 
             FROM {$this->table} vc 
             LEFT JOIN users u ON vc.created_by = u.id 
             WHERE vc.category_id = ? AND vc.type = 'public'
             ORDER BY vc.position ASC",
            [$categoryId]
        );
    }

    public function createChannel(string $name, int $createdBy, int $maxUsers = 0, ?int $categoryId = null, string $type = 'public'): int
    {
        $maxPosition = $this->db->fetchOne(
            "SELECT MAX(position) as max_pos FROM {$this->table}"
        );
        
        return $this->create([
            'name' => $name,
            'created_by' => $createdBy,
            'max_users' => $maxUsers,
            'category_id' => $categoryId,
            'type' => $type,
            'position' => ($maxPosition['max_pos'] ?? 0) + 1
        ]);
    }

    /**
     * Create a DM voice channel for private calls (max 2 users)
     */
    public function createDmVoiceChannel(int $user1Id, int $user2Id): int
    {
        $name = 'dm-voice-' . min($user1Id, $user2Id) . '-' . max($user1Id, $user2Id);

        $channelId = $this->create([
            'name' => $name,
            'created_by' => $user1Id,
            'max_users' => 2,
            'category_id' => null,
            'type' => 'dm',
            'position' => 0
        ]);

        // Add both users as participants
        $this->db->insert('channel_participants', [
            'channel_id' => $channelId,
            'channel_type' => 'voice',
            'user_id' => $user1Id
        ]);
        $this->db->insert('channel_participants', [
            'channel_id' => $channelId,
            'channel_type' => 'voice',
            'user_id' => $user2Id
        ]);

        return $channelId;
    }

    /**
     * Find existing DM voice channel between two users
     */
    public function findDmVoiceChannel(int $user1Id, int $user2Id): ?array
    {
        return $this->db->fetchOne(
            "SELECT vc.* FROM {$this->table} vc
             JOIN channel_participants cp1 ON vc.id = cp1.channel_id AND cp1.channel_type = 'voice' AND cp1.user_id = ?
             JOIN channel_participants cp2 ON vc.id = cp2.channel_id AND cp2.channel_type = 'voice' AND cp2.user_id = ?
             WHERE vc.type = 'dm'
             LIMIT 1",
            [$user1Id, $user2Id]
        );
    }

    /**
     * Get or create a DM voice channel
     */
    public function getOrCreateDmVoiceChannel(int $user1Id, int $user2Id): array
    {
        $channel = $this->findDmVoiceChannel($user1Id, $user2Id);
        if ($channel) {
            return $channel;
        }
        $channelId = $this->createDmVoiceChannel($user1Id, $user2Id);
        return $this->find($channelId);
    }

    /**
     * Check if a user is a participant of a DM voice channel
     */
    public function isChannelParticipant(int $channelId, int $userId): bool
    {
        $result = $this->db->fetchOne(
            "SELECT id FROM channel_participants 
             WHERE channel_id = ? AND channel_type = 'voice' AND user_id = ?",
            [$channelId, $userId]
        );
        return $result !== null;
    }

    public function getMembers(int $channelId): array
    {
        return $this->db->fetchAll(
            "SELECT vm.*, u.username, u.avatar, u.display_name
             FROM voice_members vm 
             JOIN users u ON vm.user_id = u.id 
             WHERE vm.channel_id = ?
             ORDER BY vm.joined_at",
            [$channelId]
        );
    }

    public function addMember(int $channelId, int $userId): int
    {
        // First remove from any existing voice channel
        $this->removeMember($userId);
        
        return $this->db->insert('voice_members', [
            'channel_id' => $channelId,
            'user_id' => $userId
        ]);
    }

    public function removeMember(int $userId): int
    {
        return $this->db->delete('voice_members', 'user_id = ?', [$userId]);
    }

    public function getMemberChannel(int $userId): ?array
    {
        return $this->db->fetchOne(
            "SELECT vc.*, vm.muted, vm.deafened 
             FROM voice_members vm 
             JOIN {$this->table} vc ON vm.channel_id = vc.id 
             WHERE vm.user_id = ?",
            [$userId]
        );
    }

    public function getAllWithMembers(): array
    {
        $channels = $this->getAllOrdered();
        
        foreach ($channels as &$channel) {
            $channel['members'] = $this->getMembers($channel['id']);
        }
        
        return $channels;
    }

    /**
     * Get user's active DM voice call (if in one)
     */
    public function getUserActiveDmCall(int $userId): ?array
    {
        // Find if user is currently in a DM voice channel
        $channel = $this->db->fetchOne(
            "SELECT vc.*, 
                    cp1.user_id as participant_1,
                    cp2.user_id as participant_2
             FROM voice_members vm
             JOIN {$this->table} vc ON vm.channel_id = vc.id
             JOIN channel_participants cp1 ON vc.id = cp1.channel_id AND cp1.channel_type = 'voice'
             JOIN channel_participants cp2 ON vc.id = cp2.channel_id AND cp2.channel_type = 'voice' AND cp2.user_id != cp1.user_id
             WHERE vm.user_id = ? AND vc.type = 'dm'
             LIMIT 1",
            [$userId]
        );
        
        return $channel ?: null;
    }

    /**
     * Get any active DM voice call for a user (either they're in it, or their friend is)
     */
    public function getAnyActiveDmCallForUser(int $userId): ?array
    {
        // Find any DM voice channel where the user is a participant AND has active members
        $channel = $this->db->fetchOne(
            "SELECT vc.*, 
                    cp1.user_id as participant_1,
                    cp2.user_id as participant_2
             FROM {$this->table} vc
             JOIN channel_participants cp1 ON vc.id = cp1.channel_id AND cp1.channel_type = 'voice'
             JOIN channel_participants cp2 ON vc.id = cp2.channel_id AND cp2.channel_type = 'voice' AND cp2.user_id != cp1.user_id
             WHERE vc.type = 'dm'
             AND (cp1.user_id = ? OR cp2.user_id = ?)
             AND EXISTS (SELECT 1 FROM voice_members vm WHERE vm.channel_id = vc.id)
             LIMIT 1",
            [$userId, $userId]
        );
        
        return $channel ?: null;
    }
}
