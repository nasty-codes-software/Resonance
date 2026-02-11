<?php

declare(strict_types=1);

namespace App\Models;

class InviteCode extends BaseModel
{
    protected string $table = 'invite_codes';

    /**
     * Generate a random invite code
     */
    public static function generateCode(int $length = 8): string
    {
        $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        $code = '';
        for ($i = 0; $i < $length; $i++) {
            $code .= $chars[random_int(0, strlen($chars) - 1)];
        }
        return $code;
    }

    /**
     * Create a new invite code
     */
    public function createCode(int $createdBy, ?int $maxUses = null, ?\DateTime $expiresAt = null): array
    {
        $code = self::generateCode();
        
        // Make sure code is unique
        while ($this->findByCode($code)) {
            $code = self::generateCode();
        }

        $id = $this->create([
            'code' => $code,
            'created_by' => $createdBy,
            'max_uses' => $maxUses,
            'uses' => 0,
            'expires_at' => $expiresAt?->format('Y-m-d H:i:s'),
        ]);

        return $this->find($id);
    }

    /**
     * Find invite code by code string
     */
    public function findByCode(string $code): ?array
    {
        return $this->db->fetchOne(
            "SELECT * FROM {$this->table} WHERE code = ?",
            [strtoupper($code)]
        );
    }

    /**
     * Check if a code is valid (exists, not expired, not max uses reached)
     */
    public function isValid(string $code): bool
    {
        $invite = $this->findByCode($code);
        
        if (!$invite) {
            return false;
        }

        // Check if expired
        if ($invite['expires_at'] && new \DateTime($invite['expires_at']) < new \DateTime()) {
            return false;
        }

        // Check if max uses reached
        if ($invite['max_uses'] !== null && $invite['uses'] >= $invite['max_uses']) {
            return false;
        }

        return true;
    }

    /**
     * Use an invite code (increment uses counter)
     */
    public function useCode(string $code, int $userId): bool
    {
        $invite = $this->findByCode($code);
        
        if (!$invite || !$this->isValid($code)) {
            return false;
        }

        // Increment uses
        $this->db->query(
            "UPDATE {$this->table} SET uses = uses + 1 WHERE id = ?",
            [$invite['id']]
        );

        // Log the usage
        $this->db->query(
            "INSERT INTO invite_code_uses (invite_code_id, user_id, used_at) VALUES (?, ?, NOW())",
            [$invite['id'], $userId]
        );

        return true;
    }

    /**
     * Get all invite codes with creator info
     */
    public function getAllWithCreator(): array
    {
        return $this->db->fetchAll(
            "SELECT ic.*, u.username as created_by_username
             FROM {$this->table} ic
             LEFT JOIN users u ON ic.created_by = u.id
             ORDER BY ic.created_at DESC"
        );
    }

    /**
     * Delete expired or used-up codes
     */
    public function deleteExpired(): int
    {
        $stmt = $this->db->query(
            "DELETE FROM {$this->table} 
             WHERE (expires_at IS NOT NULL AND expires_at < NOW())
             OR (max_uses IS NOT NULL AND uses >= max_uses)"
        );
        return $stmt->rowCount();
    }

    /**
     * Revoke (delete) an invite code
     */
    public function revoke(int $id): bool
    {
        return $this->delete($id) > 0;
    }
}
