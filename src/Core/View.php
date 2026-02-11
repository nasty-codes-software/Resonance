<?php

declare(strict_types=1);

namespace App\Core;

use Twig\Environment;
use Twig\Loader\FilesystemLoader;
use Twig\TwigFunction;

class View
{
    private static ?Environment $twig = null;

    public static function init(string $templatesPath): void
    {
        $loader = new FilesystemLoader($templatesPath);
        
        self::$twig = new Environment($loader, [
            'cache' => $_ENV['APP_DEBUG'] === 'true' ? false : __DIR__ . '/../../storage/cache/twig',
            'debug' => $_ENV['APP_DEBUG'] === 'true',
            'auto_reload' => true,
        ]);

        // Add global functions
        self::$twig->addFunction(new TwigFunction('csrf_token', [self::class, 'csrfToken']));
        self::$twig->addFunction(new TwigFunction('csrf_field', [self::class, 'csrfField'], ['is_safe' => ['html']]));
        self::$twig->addFunction(new TwigFunction('asset', [self::class, 'asset']));
        self::$twig->addFunction(new TwigFunction('url', [self::class, 'url']));
        self::$twig->addFunction(new TwigFunction('auth', [self::class, 'auth']));
        self::$twig->addFunction(new TwigFunction('old', [self::class, 'old']));

        // Add global variables
        self::$twig->addGlobal('app_name', $_ENV['APP_NAME'] ?? 'Resonance');
        self::$twig->addGlobal('ws_port', $_ENV['WS_PORT'] ?? '8081');
        self::$twig->addGlobal('dm_call_timeout', (int)($_ENV['DM_CALL_TIMEOUT'] ?? 120));
    }

    public static function render(string $template, array $data = []): string
    {
        if (self::$twig === null) {
            throw new \RuntimeException('View not initialized. Call View::init() first.');
        }

        // Add flash messages
        $data['flash'] = Session::getFlash();
        
        return self::$twig->render($template, $data);
    }

    public static function csrfToken(): string
    {
        return Session::getCsrfToken();
    }

    public static function csrfField(): string
    {
        $token = self::csrfToken();
        return '<input type="hidden" name="_csrf_token" value="' . htmlspecialchars($token) . '">';
    }

    public static function asset(string $path): string
    {
        return '/assets/' . ltrim($path, '/');
    }

    public static function url(string $path): string
    {
        return '/' . ltrim($path, '/');
    }

    public static function auth(): ?array
    {
        return Session::getUser();
    }

    public static function old(string $key, string $default = ''): string
    {
        return $_SESSION['_old_input'][$key] ?? $default;
    }
}
