<?php

declare(strict_types=1);

namespace App\Models;

class Message extends BaseModel
{
    protected string $table = 'messages';

    public function getChannelMessages(int $channelId, int $limit = 50, int $offset = 0): array
    {
        return $this->db->fetchAll(
            "SELECT m.*, u.username, u.avatar 
             FROM {$this->table} m 
             JOIN users u ON m.user_id = u.id 
             WHERE m.channel_id = ? 
             ORDER BY m.created_at DESC 
             LIMIT ? OFFSET ?",
            [$channelId, $limit, $offset]
        );
    }

    public function createMessage(int $channelId, int $userId, string $content, ?string $attachmentUrl = null, ?string $attachmentType = null, ?string $attachmentName = null): int
    {
        $data = [
            'channel_id' => $channelId,
            'user_id' => $userId,
            'content' => $content
        ];
        
        if ($attachmentUrl) {
            $data['attachment_url'] = $attachmentUrl;
            $data['attachment_type'] = $attachmentType;
            $data['attachment_name'] = $attachmentName;
        }
        
        return $this->create($data);
    }

    public function getMessageWithUser(int $messageId): ?array
    {
        return $this->db->fetchOne(
            "SELECT m.*, u.username, u.avatar 
             FROM {$this->table} m 
             JOIN users u ON m.user_id = u.id 
             WHERE m.id = ?",
            [$messageId]
        );
    }

    public function updateContent(int $messageId, string $content): int
    {
        return $this->update($messageId, [
            'content' => $content,
            'edited' => 1
        ]);
    }

    public function deleteChannelMessages(int $channelId): int
    {
        return $this->db->delete($this->table, 'channel_id = ?', [$channelId]);
    }

    public function getUserMessageCount(int $userId): int
    {
        $result = $this->db->fetchOne(
            "SELECT COUNT(*) as count FROM {$this->table} WHERE user_id = ?",
            [$userId]
        );
        return (int) ($result['count'] ?? 0);
    }

    public function getPinnedMessages(int $channelId): array
    {
        return $this->db->fetchAll(
            "SELECT m.*, u.username, u.avatar 
             FROM {$this->table} m 
             JOIN users u ON m.user_id = u.id 
             WHERE m.channel_id = ? AND m.pinned = 1 
             ORDER BY m.pinned_at DESC",
            [$channelId]
        );
    }

    public function searchMessages(int $channelId, string $query, int $limit = 20): array
    {
        $searchTerm = '%' . $query . '%';
        return $this->db->fetchAll(
            "SELECT m.*, u.username, u.avatar 
             FROM {$this->table} m 
             JOIN users u ON m.user_id = u.id 
             WHERE m.channel_id = ? AND m.content LIKE ? 
             ORDER BY m.created_at DESC 
             LIMIT ?",
            [$channelId, $searchTerm, $limit]
        );
    }

    public function searchAllMessages(string $query, int $limit = 30): array
    {
        $searchTerm = '%' . $query . '%';
        return $this->db->fetchAll(
            "SELECT m.*, u.username, u.avatar, c.name as channel_name, c.id as channel_id
             FROM {$this->table} m 
             JOIN users u ON m.user_id = u.id 
             JOIN text_channels c ON m.channel_id = c.id
             WHERE m.content LIKE ? 
             ORDER BY m.created_at DESC 
             LIMIT ?",
            [$searchTerm, $limit]
        );
    }

    public function pinMessage(int $messageId): int
    {
        return $this->update($messageId, [
            'pinned' => 1,
            'pinned_at' => date('Y-m-d H:i:s')
        ]);
    }

    public function unpinMessage(int $messageId): int
    {
        return $this->update($messageId, [
            'pinned' => 0,
            'pinned_at' => null
        ]);
    }
}
