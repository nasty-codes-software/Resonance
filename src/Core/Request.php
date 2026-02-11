<?php

declare(strict_types=1);

namespace App\Core;

class Request
{
    private array $query;
    private array $post;
    private array $server;
    private array $files;
    private array $cookies;
    private ?array $json = null;
    private array $params = [];

    public function __construct()
    {
        $this->query = $_GET;
        $this->post = $_POST;
        $this->server = $_SERVER;
        $this->files = $_FILES;
        $this->cookies = $_COOKIE;
    }

    public function setParams(array $params): self
    {
        $this->params = $params;
        return $this;
    }

    public function param(string $key, mixed $default = null): mixed
    {
        return $this->params[$key] ?? $default;
    }

    public function params(): array
    {
        return $this->params;
    }

    public function getMethod(): string
    {
        return strtoupper($this->server['REQUEST_METHOD'] ?? 'GET');
    }

    public function getUri(): string
    {
        return $this->server['REQUEST_URI'] ?? '/';
    }

    public function getPath(): string
    {
        return parse_url($this->getUri(), PHP_URL_PATH) ?? '/';
    }

    public function query(string $key, mixed $default = null): mixed
    {
        return $this->query[$key] ?? $default;
    }

    public function post(string $key, mixed $default = null): mixed
    {
        return $this->post[$key] ?? $default;
    }

    public function input(string $key, mixed $default = null): mixed
    {
        return $this->post[$key] ?? $this->query[$key] ?? $this->json()[$key] ?? $default;
    }

    public function all(): array
    {
        return array_merge($this->query, $this->post, $this->json() ?? []);
    }

    public function json(): ?array
    {
        if ($this->json === null) {
            $content = file_get_contents('php://input');
            if ($content) {
                $this->json = json_decode($content, true) ?? [];
            }
        }
        return $this->json;
    }

    public function file(string $key): ?array
    {
        return $this->files[$key] ?? null;
    }

    public function files(): array
    {
        return $this->files;
    }

    public function cookie(string $key, mixed $default = null): mixed
    {
        return $this->cookies[$key] ?? $default;
    }

    public function header(string $key, mixed $default = null): mixed
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $key));
        return $this->server[$key] ?? $default;
    }

    public function isAjax(): bool
    {
        return $this->header('X-Requested-With') === 'XMLHttpRequest';
    }

    public function isJson(): bool
    {
        $contentType = $this->server['CONTENT_TYPE'] ?? '';
        return str_contains($contentType, 'application/json');
    }

    public function ip(): string
    {
        return $this->server['REMOTE_ADDR'] ?? '0.0.0.0';
    }

    public function userAgent(): string
    {
        return $this->server['HTTP_USER_AGENT'] ?? '';
    }
}
