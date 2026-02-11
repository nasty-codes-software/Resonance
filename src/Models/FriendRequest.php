<?php

declare(strict_types=1);

namespace App\Models;

class FriendRequest extends BaseModel
{
    protected string $table = 'friend_requests';

    /**
     * Send a friend request. Prevents self-requests and duplicates.
     */
    public function sendRequest(int $senderId, int $receiverId): int|false
    {
        // Prevent self-request
        if ($senderId === $receiverId) {
            return false;
        }

        // Check for existing pending request in either direction
        $existing = $this->db->fetchOne(
            "SELECT id, status FROM {$this->table} 
             WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
             AND status = 'pending'",
            [$senderId, $receiverId, $receiverId, $senderId]
        );

        if ($existing) {
            return false;
        }

        // Check if already friends
        $friendship = new Friendship($this->db);
        if ($friendship->areFriends($senderId, $receiverId)) {
            return false;
        }

        return $this->create([
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'status' => 'pending'
        ]);
    }

    /**
     * Accept a friend request
     */
    public function acceptRequest(int $requestId, int $userId): bool
    {
        $request = $this->find($requestId);
        if (!$request || $request['receiver_id'] !== $userId || $request['status'] !== 'pending') {
            return false;
        }

        $this->update($requestId, ['status' => 'accepted']);

        // Create friendship
        $friendship = new Friendship($this->db);
        $friendship->createFriendship($request['sender_id'], $request['receiver_id']);

        return true;
    }

    /**
     * Decline a friend request
     */
    public function declineRequest(int $requestId, int $userId): bool
    {
        $request = $this->find($requestId);
        if (!$request || $request['receiver_id'] !== $userId || $request['status'] !== 'pending') {
            return false;
        }

        $this->update($requestId, ['status' => 'declined']);
        return true;
    }

    /**
     * Cancel a sent friend request
     */
    public function cancelRequest(int $requestId, int $userId): bool
    {
        $request = $this->find($requestId);
        if (!$request || $request['sender_id'] !== $userId || $request['status'] !== 'pending') {
            return false;
        }

        $this->delete($requestId);
        return true;
    }

    /**
     * Get pending requests received by a user
     */
    public function getPendingReceived(int $userId): array
    {
        return $this->db->fetchAll(
            "SELECT fr.*, u.username as sender_username, u.display_name as sender_display_name, 
                    u.avatar as sender_avatar, u.status as sender_status
             FROM {$this->table} fr
             JOIN users u ON fr.sender_id = u.id
             WHERE fr.receiver_id = ? AND fr.status = 'pending'
             ORDER BY fr.created_at DESC",
            [$userId]
        );
    }

    /**
     * Get pending requests sent by a user
     */
    public function getPendingSent(int $userId): array
    {
        return $this->db->fetchAll(
            "SELECT fr.*, u.username as receiver_username, u.display_name as receiver_display_name,
                    u.avatar as receiver_avatar, u.status as receiver_status
             FROM {$this->table} fr
             JOIN users u ON fr.receiver_id = u.id
             WHERE fr.sender_id = ? AND fr.status = 'pending'
             ORDER BY fr.created_at DESC",
            [$userId]
        );
    }

    /**
     * Get total pending request count for a user (incoming)
     */
    public function getPendingCount(int $userId): int
    {
        $result = $this->db->fetchOne(
            "SELECT COUNT(*) as count FROM {$this->table} 
             WHERE receiver_id = ? AND status = 'pending'",
            [$userId]
        );
        return (int)($result['count'] ?? 0);
    }
}
