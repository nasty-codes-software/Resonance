<?php

declare(strict_types=1);

namespace App\Models;

use App\Core\Database;

abstract class BaseModel
{
    protected Database $db;
    protected string $table;
    protected string $primaryKey = 'id';

    public function __construct(Database $db)
    {
        $this->db = $db;
    }

    public function find(int $id): ?array
    {
        return $this->db->fetchOne(
            "SELECT * FROM {$this->table} WHERE {$this->primaryKey} = ?",
            [$id]
        );
    }

    public function findBy(string $column, mixed $value): ?array
    {
        return $this->db->fetchOne(
            "SELECT * FROM {$this->table} WHERE {$column} = ?",
            [$value]
        );
    }

    public function all(string $orderBy = 'id', string $direction = 'ASC'): array
    {
        return $this->db->fetchAll(
            "SELECT * FROM {$this->table} ORDER BY {$orderBy} {$direction}"
        );
    }

    public function create(array $data): int
    {
        return $this->db->insert($this->table, $data);
    }

    public function update(int $id, array $data): int
    {
        return $this->db->update($this->table, $data, "{$this->primaryKey} = ?", [$id]);
    }

    public function delete(int $id): int
    {
        return $this->db->delete($this->table, "{$this->primaryKey} = ?", [$id]);
    }

    public function count(): int
    {
        $result = $this->db->fetchOne("SELECT COUNT(*) as count FROM {$this->table}");
        return (int) ($result['count'] ?? 0);
    }
}
