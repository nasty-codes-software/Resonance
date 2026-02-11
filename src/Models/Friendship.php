<?php

declare(strict_types=1);

namespace App\Models;

class Friendship extends BaseModel
{
    protected string $table = 'friendships';

    /**
     * Create a friendship (always stores lower user_id as user1)
     */
    public function createFriendship(int $userId1, int $userId2): int
    {
        $user1 = min($userId1, $userId2);
        $user2 = max($userId1, $userId2);

        // Create DM text channel
        $textChannel = new TextChannel($this->db);
        $dmChannel = $textChannel->getOrCreateDmChannel($user1, $user2);

        // Create DM voice channel
        $voiceChannel = new VoiceChannel($this->db);
        $dmVoice = $voiceChannel->getOrCreateDmVoiceChannel($user1, $user2);

        return $this->create([
            'user1_id' => $user1,
            'user2_id' => $user2,
            'dm_channel_id' => $dmChannel['id'],
            'voice_channel_id' => $dmVoice['id']
        ]);
    }

    /**
     * Check if two users are friends
     */
    public function areFriends(int $userId1, int $userId2): bool
    {
        $user1 = min($userId1, $userId2);
        $user2 = max($userId1, $userId2);

        $result = $this->db->fetchOne(
            "SELECT id FROM {$this->table} WHERE user1_id = ? AND user2_id = ?",
            [$user1, $user2]
        );

        return $result !== null;
    }

    /**
     * Get a friendship record between two users
     */
    public function getFriendship(int $userId1, int $userId2): ?array
    {
        $user1 = min($userId1, $userId2);
        $user2 = max($userId1, $userId2);

        return $this->db->fetchOne(
            "SELECT * FROM {$this->table} WHERE user1_id = ? AND user2_id = ?",
            [$user1, $user2]
        );
    }

    /**
     * Get all friends of a user with their profile info and DM channel data
     */
    public function getFriends(int $userId): array
    {
        return $this->db->fetchAll(
            "SELECT f.id as friendship_id, f.dm_channel_id, f.voice_channel_id, f.created_at as friends_since,
                    u.id as friend_id, u.username, u.display_name, u.avatar, u.status, u.custom_status,
                    (SELECT r.color FROM roles r 
                     JOIN user_roles ur ON r.id = ur.role_id 
                     WHERE ur.user_id = u.id 
                     ORDER BY r.position DESC LIMIT 1) as role_color
             FROM {$this->table} f
             JOIN users u ON (u.id = CASE WHEN f.user1_id = ? THEN f.user2_id ELSE f.user1_id END)
             WHERE f.user1_id = ? OR f.user2_id = ?
             ORDER BY u.status != 'offline' DESC, u.username ASC",
            [$userId, $userId, $userId]
        );
    }

    /**
     * Remove a friendship and optionally clean up DM channels
     */
    public function removeFriendship(int $userId1, int $userId2): bool
    {
        $user1 = min($userId1, $userId2);
        $user2 = max($userId1, $userId2);

        $friendship = $this->getFriendship($userId1, $userId2);
        if (!$friendship) {
            return false;
        }

        // Delete the friendship (DM channels are kept for message history, FK SET NULL)
        $this->db->delete($this->table, 'user1_id = ? AND user2_id = ?', [$user1, $user2]);
        return true;
    }

    /**
     * Get the DM channel ID for a friendship
     */
    public function getDmChannelId(int $userId1, int $userId2): ?int
    {
        $friendship = $this->getFriendship($userId1, $userId2);
        return $friendship ? (int)$friendship['dm_channel_id'] : null;
    }

    /**
     * Get the voice channel ID for a friendship
     */
    public function getVoiceChannelId(int $userId1, int $userId2): ?int
    {
        $friendship = $this->getFriendship($userId1, $userId2);
        return $friendship ? (int)$friendship['voice_channel_id'] : null;
    }
}
