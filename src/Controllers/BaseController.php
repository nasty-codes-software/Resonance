<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use App\Core\Session;
use App\Core\View;

abstract class BaseController
{
    protected Database $db;
    protected Response $response;

    public function __construct(Database $db)
    {
        $this->db = $db;
        $this->response = new Response();
    }

    protected function render(string $template, array $data = []): string
    {
        return View::render($template, $data);
    }

    protected function json(array $data, int $status = 200): never
    {
        $this->response->json($data, $status);
    }

    protected function redirect(string $url, int $status = 302): never
    {
        $this->response->redirect($url, $status);
    }

    protected function validateCsrf(Request $request): bool
    {
        $token = $request->post('_csrf_token') ?? $request->header('X-CSRF-Token');
        
        if (!$token || !Session::validateCsrfToken($token)) {
            return false;
        }
        
        return true;
    }

    protected function requireAuth(): void
    {
        if (!Session::isAuthenticated()) {
            Session::flash('error', 'Please log in to continue.');
            $this->redirect('/login');
        }
    }

    protected function requireAdmin(): void
    {
        $this->requireAuth();
        
        if (!Session::isAdmin()) {
            Session::flash('error', 'You do not have permission to access this page.');
            $this->redirect('/');
        }
    }

    protected function user(): ?array
    {
        return Session::getUser();
    }

    protected function userId(): ?int
    {
        return Session::getUserId();
    }
}
