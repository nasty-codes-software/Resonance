<?php

declare(strict_types=1);

namespace App\Models;

class Sound extends BaseModel
{
    protected string $table = 'sounds';
    
    public const UPLOAD_DIR = __DIR__ . '/../../storage/sounds/';
    public const ALLOWED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'];
    public const MAX_SIZE = 10485760; // 10MB

    public function getAllSounds(): array
    {
        return $this->db->fetchAll(
            "SELECT s.*, u.username as uploader 
             FROM {$this->table} s 
             JOIN users u ON s.uploaded_by = u.id 
             ORDER BY s.name ASC"
        );
    }

    public function getUserSounds(int $userId): array
    {
        return $this->db->fetchAll(
            "SELECT * FROM {$this->table} WHERE uploaded_by = ? ORDER BY name ASC",
            [$userId]
        );
    }

    public function uploadSound(array $file, string $name, int $userId): array
    {
        // Validate file type
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mimeType = $finfo->file($file['tmp_name']);
        
        if (!in_array($mimeType, self::ALLOWED_TYPES)) {
            return ['error' => 'Invalid file type. Only MP3, WAV, and OGG files are allowed.'];
        }

        // Validate file size
        if ($file['size'] > self::MAX_SIZE) {
            return ['error' => 'File too large. Maximum size is 10MB.'];
        }

        // Generate unique filename
        $extension = pathinfo($file['name'], PATHINFO_EXTENSION);
        $filename = uniqid('sound_', true) . '.' . strtolower($extension);
        $filepath = self::UPLOAD_DIR . $filename;

        // Ensure directory exists
        if (!is_dir(self::UPLOAD_DIR)) {
            mkdir(self::UPLOAD_DIR, 0755, true);
        }

        // Move file
        if (!move_uploaded_file($file['tmp_name'], $filepath)) {
            return ['error' => 'Failed to save file.'];
        }

        // Create database record
        $id = $this->create([
            'name' => $name,
            'filename' => $filename,
            'original_name' => $file['name'],
            'size' => $file['size'],
            'uploaded_by' => $userId
        ]);

        return [
            'success' => true,
            'id' => $id,
            'filename' => $filename
        ];
    }

    public function deleteSound(int $id): bool
    {
        $sound = $this->find($id);
        
        if (!$sound) {
            return false;
        }

        // Delete file
        $filepath = self::UPLOAD_DIR . $sound['filename'];
        if (file_exists($filepath)) {
            unlink($filepath);
        }

        // Delete database record
        $this->delete($id);
        
        return true;
    }

    public function getFilePath(int $id): ?string
    {
        $sound = $this->find($id);
        
        if (!$sound) {
            return null;
        }

        $filepath = self::UPLOAD_DIR . $sound['filename'];
        
        return file_exists($filepath) ? $filepath : null;
    }
}
