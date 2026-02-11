<?php

declare(strict_types=1);

namespace App\Core;

class Response
{
    private int $statusCode = 200;
    private array $headers = [];
    private string $content = '';

    public function setStatusCode(int $code): self
    {
        $this->statusCode = $code;
        return $this;
    }

    public function setHeader(string $name, string $value): self
    {
        $this->headers[$name] = $value;
        return $this;
    }

    public function setContent(string $content): self
    {
        $this->content = $content;
        return $this;
    }

    public function json(array $data, int $statusCode = 200): never
    {
        $this->setStatusCode($statusCode);
        $this->setHeader('Content-Type', 'application/json');
        $this->setContent(json_encode($data, JSON_UNESCAPED_UNICODE));
        $this->send();
    }

    public function html(string $html, int $statusCode = 200): never
    {
        $this->setStatusCode($statusCode);
        $this->setHeader('Content-Type', 'text/html; charset=utf-8');
        $this->setContent($html);
        $this->send();
    }

    public function redirect(string $url, int $statusCode = 302): never
    {
        $this->setStatusCode($statusCode);
        $this->setHeader('Location', $url);
        $this->send();
    }

    public function send(): never
    {
        http_response_code($this->statusCode);
        
        foreach ($this->headers as $name => $value) {
            header("{$name}: {$value}");
        }
        
        echo $this->content;
        exit;
    }

    public static function error(string $message, int $statusCode = 400): never
    {
        (new self())->json(['error' => $message], $statusCode);
    }

    public static function success(array $data = [], string $message = 'Success'): never
    {
        (new self())->json([
            'success' => true,
            'message' => $message,
            'data' => $data
        ]);
    }
}
