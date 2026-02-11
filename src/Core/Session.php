<?php

declare(strict_types=1);

namespace App\Core;

class Session
{
    private static bool $started = false;

    public static function start(): void
    {
        if (self::$started) {
            return;
        }

        if (session_status() === PHP_SESSION_NONE) {
            session_set_cookie_params([
                'lifetime' => (int)($_ENV['SESSION_LIFETIME'] ?? 7200),
                'path' => '/',
                'secure' => $_ENV['APP_ENV'] === 'production',
                'httponly' => true,
                'samesite' => 'Lax'
            ]);
            session_start();
        }

        self::$started = true;

        // Regenerate session ID periodically
        if (!isset($_SESSION['_created'])) {
            $_SESSION['_created'] = time();
        } elseif (time() - $_SESSION['_created'] > 1800) {
            session_regenerate_id(true);
            $_SESSION['_created'] = time();
        }
    }

    public static function set(string $key, mixed $value): void
    {
        $_SESSION[$key] = $value;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return $_SESSION[$key] ?? $default;
    }

    public static function has(string $key): bool
    {
        return isset($_SESSION[$key]);
    }

    public static function remove(string $key): void
    {
        unset($_SESSION[$key]);
    }

    public static function destroy(): void
    {
        $_SESSION = [];
        
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params['path'],
                $params['domain'],
                $params['secure'],
                $params['httponly']
            );
        }
        
        session_destroy();
        self::$started = false;
    }

    public static function flash(string $key, mixed $value): void
    {
        $_SESSION['_flash'][$key] = $value;
    }

    public static function getFlash(): array
    {
        $flash = $_SESSION['_flash'] ?? [];
        unset($_SESSION['_flash']);
        return $flash;
    }

    public static function setUser(array $user): void
    {
        self::set('user', $user);
    }

    public static function getUser(): ?array
    {
        return self::get('user');
    }

    public static function updateUser(array $data): void
    {
        $user = self::getUser();
        if ($user) {
            self::setUser(array_merge($user, $data));
        }
    }

    public static function isAuthenticated(): bool
    {
        return self::has('user');
    }

    public static function getUserId(): ?int
    {
        return self::get('user')['id'] ?? null;
    }

    public static function isAdmin(): bool
    {
        return (self::get('user')['role'] ?? '') === 'admin';
    }

    // CSRF Protection
    public static function getCsrfToken(): string
    {
        if (!self::has('_csrf_token')) {
            self::set('_csrf_token', bin2hex(random_bytes(32)));
        }
        return self::get('_csrf_token');
    }

    public static function validateCsrfToken(string $token): bool
    {
        return hash_equals(self::getCsrfToken(), $token);
    }

    public static function regenerateCsrfToken(): string
    {
        $token = bin2hex(random_bytes(32));
        self::set('_csrf_token', $token);
        return $token;
    }
}
