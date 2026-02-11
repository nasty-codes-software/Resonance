<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\Request;
use App\Core\Session;
use App\Core\View;
use App\Core\Database;
use App\Models\User;
use App\Models\InviteCode;

class AuthController extends BaseController
{
    private User $userModel;
    private InviteCode $inviteCodeModel;

    public function __construct(Database $db)
    {
        parent::__construct($db);
        $this->userModel = new User($db);
        $this->inviteCodeModel = new InviteCode($db);
    }

    public function showLogin(Request $request): void
    {
        if (Session::isAuthenticated()) {
            $this->redirect('/');
        }

        $html = $this->render('auth/login.twig');
        $this->response->html($html);
    }

    public function login(Request $request): void
    {
        if (!$this->validateCsrf($request)) {
            Session::flash('error', 'Invalid security token. Please try again.');
            $this->redirect('/login');
        }

        $email = trim($request->post('email', ''));
        $password = $request->post('password', '');

        if (empty($email) || empty($password)) {
            Session::flash('error', 'Please fill in all fields.');
            $this->redirect('/login');
        }

        $user = $this->userModel->findByEmail($email);

        if (!$user || !$this->userModel->verifyPassword($user, $password)) {
            Session::flash('error', 'Invalid email or password.');
            $this->redirect('/login');
        }

        // Set user online
        $this->userModel->setOnline($user['id']);

        // Store user in session (without password)
        Session::setUser($this->userModel->toPublic($user));
        Session::regenerateCsrfToken();

        Session::flash('success', 'Welcome back, ' . $user['username'] . '!');
        $this->redirect('/');
    }

    public function showRegister(Request $request): void
    {
        if (Session::isAuthenticated()) {
            $this->redirect('/');
        }

        $html = $this->render('auth/register.twig');
        $this->response->html($html);
    }

    public function register(Request $request): void
    {
        if (!$this->validateCsrf($request)) {
            Session::flash('error', 'Invalid security token. Please try again.');
            $this->redirect('/register');
        }

        $username = trim($request->post('username', ''));
        $email = trim($request->post('email', ''));
        $password = $request->post('password', '');
        $passwordConfirm = $request->post('password_confirm', '');
        $inviteCode = strtoupper(trim($request->post('invite_code', '')));

        // Validation
        $errors = [];

        // Validate invite code first
        if (empty($inviteCode)) {
            $errors[] = 'An invite code is required to register.';
        } elseif (!$this->inviteCodeModel->isValid($inviteCode)) {
            $errors[] = 'Invalid or expired invite code.';
        }

        if (strlen($username) < 3 || strlen($username) > 50) {
            $errors[] = 'Username must be between 3 and 50 characters.';
        }

        if (!preg_match('/^[a-zA-Z0-9_]+$/', $username)) {
            $errors[] = 'Username can only contain letters, numbers, and underscores.';
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = 'Please enter a valid email address.';
        }

        if (strlen($password) < 8) {
            $errors[] = 'Password must be at least 8 characters.';
        }

        if ($password !== $passwordConfirm) {
            $errors[] = 'Passwords do not match.';
        }

        // Check if username exists
        if ($this->userModel->findByUsername($username)) {
            $errors[] = 'Username is already taken.';
        }

        // Check if email exists
        if ($this->userModel->findByEmail($email)) {
            $errors[] = 'Email is already registered.';
        }

        if (!empty($errors)) {
            Session::flash('error', implode('<br>', $errors));
            $_SESSION['_old_input'] = ['username' => $username, 'email' => $email, 'invite_code' => $inviteCode];
            $this->redirect('/register');
        }

        // Create user
        $userId = $this->userModel->createUser($username, $email, $password);
        $user = $this->userModel->find($userId);

        // Mark invite code as used
        $this->inviteCodeModel->useCode($inviteCode, $userId);

        // Log in the user
        $this->userModel->setOnline($userId);
        Session::setUser($this->userModel->toPublic($user));

        Session::flash('success', 'Welcome to Resonance, ' . $username . '!');
        $this->redirect('/');
    }

    public function logout(Request $request): void
    {
        if (Session::isAuthenticated()) {
            $this->userModel->setOffline(Session::getUserId());
        }

        Session::destroy();
        Session::start();
        
        Session::flash('success', 'You have been logged out.');
        $this->redirect('/login');
    }
}
