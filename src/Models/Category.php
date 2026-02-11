<?php

declare(strict_types=1);

namespace App\Models;

class Category extends BaseModel
{
    protected string $table = 'categories';

    public function getAllOrdered(): array
    {
        return $this->db->fetchAll(
            "SELECT * FROM {$this->table} ORDER BY position ASC"
        );
    }

    public function getAllWithChannels(): array
    {
        $categories = $this->getAllOrdered();
        
        foreach ($categories as &$category) {
            $category['text_channels'] = $this->db->fetchAll(
                "SELECT * FROM text_channels WHERE category_id = ? AND type = 'public' ORDER BY position ASC",
                [$category['id']]
            );
            $category['voice_channels'] = $this->db->fetchAll(
                "SELECT vc.*, GROUP_CONCAT(vm.user_id) as member_ids
                 FROM voice_channels vc
                 LEFT JOIN voice_members vm ON vc.id = vm.channel_id
                 WHERE vc.category_id = ? AND vc.type = 'public'
                 GROUP BY vc.id
                 ORDER BY vc.position ASC",
                [$category['id']]
            );
            
            // Get members for each voice channel
            foreach ($category['voice_channels'] as &$vc) {
                if ($vc['member_ids']) {
                    $vc['members'] = $this->db->fetchAll(
                        "SELECT vm.*, u.username, u.avatar, u.status
                         FROM voice_members vm
                         JOIN users u ON vm.user_id = u.id
                         WHERE vm.channel_id = ?",
                        [$vc['id']]
                    );
                } else {
                    $vc['members'] = [];
                }
                unset($vc['member_ids']);
            }
        }
        
        return $categories;
    }

    public function getUncategorizedChannels(): array
    {
        return [
            'text_channels' => $this->db->fetchAll(
                "SELECT * FROM text_channels WHERE category_id IS NULL AND type = 'public' ORDER BY position ASC"
            ),
            'voice_channels' => $this->db->fetchAll(
                "SELECT * FROM voice_channels WHERE category_id IS NULL AND type = 'public' ORDER BY position ASC"
            )
        ];
    }

    public function createCategory(string $name, int $userId): int
    {
        $maxPosition = $this->db->fetchOne(
            "SELECT MAX(position) as max_pos FROM {$this->table}"
        );
        $position = ($maxPosition['max_pos'] ?? -1) + 1;

        return $this->create([
            'name' => $name,
            'position' => $position,
            'created_by' => $userId
        ]);
    }
}
