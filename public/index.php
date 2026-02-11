<?php

declare(strict_types=1);

/**
 * Resonance - A private chat application with WebSocket support, built with PHP and ReactPHP.
 * Front Controller
 */

// Error reporting for development
error_reporting(E_ALL);
ini_set('display_errors', '1');

// Define base path
define('BASE_PATH', dirname(__DIR__));

// Load Composer autoloader
require BASE_PATH . '/vendor/autoload.php';

// Load environment variables
$dotenv = Dotenv\Dotenv::createImmutable(BASE_PATH);
$dotenv->load();

// Start session
use App\Core\Session;
Session::start();

// Initialize View
use App\Core\View;
View::init(BASE_PATH . '/templates');

// Initialize Router
use App\Core\Router;
use App\Controllers\AuthController;
use App\Controllers\HomeController;
use App\Controllers\Api\ChannelController;
use App\Controllers\Api\VoiceController;
use App\Controllers\Api\SoundController;
use App\Controllers\Api\UserController;
use App\Controllers\Api\CategoryController;
use App\Controllers\Api\RoleController;
use App\Controllers\Api\MessageController;
use App\Controllers\Api\FriendController;
use App\Controllers\Api\DmController;

$router = new Router();

// Web Routes
$router->get('/', [HomeController::class, 'index']);
$router->get('/login', [AuthController::class, 'showLogin']);
$router->post('/login', [AuthController::class, 'login']);
$router->get('/register', [AuthController::class, 'showRegister']);
$router->post('/register', [AuthController::class, 'register']);
$router->get('/logout', [AuthController::class, 'logout']);

// API Routes - Categories
$router->get('/api/categories', [CategoryController::class, 'list']);
$router->post('/api/categories', [CategoryController::class, 'create']);
$router->get('/api/categories/{id}', [CategoryController::class, 'get']);
$router->put('/api/categories/{id}', [CategoryController::class, 'update']);
$router->delete('/api/categories/{id}', [CategoryController::class, 'delete']);

// API Routes - Channels
$router->get('/api/channels', [ChannelController::class, 'list']);
$router->post('/api/channels', [ChannelController::class, 'create']);
$router->get('/api/channels/{id}', [ChannelController::class, 'get']);
$router->put('/api/channels/{id}', [ChannelController::class, 'update']);
$router->delete('/api/channels/{id}', [ChannelController::class, 'delete']);
$router->get('/api/channels/{id}/messages', [ChannelController::class, 'getMessages']);
$router->get('/api/channels/{id}/pinned', [ChannelController::class, 'getPinnedMessages']);
$router->get('/api/channels/{id}/search', [ChannelController::class, 'searchMessages']);
$router->get('/api/search', [ChannelController::class, 'searchAllChannels']);
$router->post('/api/channels/{id}/upload', [ChannelController::class, 'uploadAttachment']);

// API Routes - Messages
$router->put('/api/messages/{id}', [MessageController::class, 'update']);
$router->delete('/api/messages/{id}', [MessageController::class, 'delete']);
$router->post('/api/messages/{id}/pin', [MessageController::class, 'togglePin']);

// API Routes - Voice
$router->get('/api/voice', [VoiceController::class, 'list']);
$router->post('/api/voice', [VoiceController::class, 'create']);
$router->get('/api/voice/{id}', [VoiceController::class, 'get']);
$router->put('/api/voice/{id}', [VoiceController::class, 'update']);
$router->delete('/api/voice/{id}', [VoiceController::class, 'delete']);
$router->post('/api/voice/{id}/join', [VoiceController::class, 'join']);
$router->post('/api/voice/leave', [VoiceController::class, 'leave']);
$router->get('/api/voice/{id}/members', [VoiceController::class, 'getMembers']);
$router->post('/api/voice/disconnect/{userId}', [VoiceController::class, 'disconnectMember']);

// API Routes - Sounds
$router->get('/api/sounds', [SoundController::class, 'list']);
$router->post('/api/sounds', [SoundController::class, 'upload']);
$router->delete('/api/sounds/{id}', [SoundController::class, 'delete']);
$router->get('/api/sounds/{id}/play', [SoundController::class, 'play']);

// API Routes - User
$router->get('/api/user/profile', [UserController::class, 'profile']);
$router->put('/api/user/profile', [UserController::class, 'updateProfile']);
$router->put('/api/user/account', [UserController::class, 'updateAccount']);
$router->get('/api/user/{id}/profile', [UserController::class, 'getProfile']);
$router->post('/api/user/avatar', [UserController::class, 'uploadAvatar']);
$router->delete('/api/user/avatar', [UserController::class, 'deleteAvatar']);
$router->post('/api/user/banner', [UserController::class, 'uploadBanner']);
$router->delete('/api/user/banner', [UserController::class, 'deleteBanner']);

// API Routes - Admin: User Management
$router->get('/api/admin/users', [UserController::class, 'getAllUsers']);
$router->delete('/api/admin/users/{id}', [UserController::class, 'deleteUser']);

// API Routes - Admin: Invite Codes
$router->get('/api/admin/invite-codes', [UserController::class, 'getInviteCodes']);
$router->post('/api/admin/invite-codes', [UserController::class, 'createInviteCode']);
$router->delete('/api/admin/invite-codes/{id}', [UserController::class, 'revokeInviteCode']);

// API Routes - Roles (Server Settings)
$router->get('/api/roles', [RoleController::class, 'list']);
$router->post('/api/roles', [RoleController::class, 'create']);
$router->put('/api/roles/{id}', [RoleController::class, 'update']);
$router->delete('/api/roles/{id}', [RoleController::class, 'delete']);
$router->get('/api/members', [RoleController::class, 'getMembers']);
$router->get('/api/members/{id}/roles', [RoleController::class, 'getUserRoles']);
$router->put('/api/members/{id}/roles', [RoleController::class, 'updateMemberRoles']);
$router->post('/api/roles/assign', [RoleController::class, 'assignRole']);
$router->post('/api/roles/remove', [RoleController::class, 'removeRole']);

// API Routes - Friends
$router->get('/api/friends', [FriendController::class, 'list']);
$router->post('/api/friends/request', [FriendController::class, 'sendRequest']);
$router->post('/api/friends/request/{id}/accept', [FriendController::class, 'acceptRequest']);
$router->post('/api/friends/request/{id}/decline', [FriendController::class, 'declineRequest']);
$router->delete('/api/friends/request/{id}', [FriendController::class, 'cancelRequest']);
$router->delete('/api/friends/{id}', [FriendController::class, 'removeFriend']);
$router->get('/api/friends/pending', [FriendController::class, 'pendingRequests']);
$router->get('/api/friends/{id}/dm', [FriendController::class, 'getDmChannel']);

// API Routes - Direct Messages
$router->get('/api/dm/conversations', [DmController::class, 'listConversations']);
$router->get('/api/dm/active-call', [DmController::class, 'getActiveCall']);
$router->get('/api/dm/{id}/messages', [DmController::class, 'getMessages']);
$router->post('/api/dm/{id}/upload', [DmController::class, 'uploadAttachment']);
$router->get('/api/dm/voice/{friendId}', [DmController::class, 'getVoiceChannel']);

// Dispatch request
$method = $_SERVER['REQUEST_METHOD'];
$uri = $_SERVER['REQUEST_URI'];

// Handle static files in development
$path = parse_url($uri, PHP_URL_PATH);
if ($path !== '/' && file_exists(__DIR__ . $path)) {
    return false; // Let PHP built-in server handle static files
}

// Handle storage files (attachments, sounds, etc.)
if (preg_match('#^/storage/(.+)$#', $path, $matches)) {
    $storagePath = dirname(__DIR__) . '/storage/' . $matches[1];
    if (file_exists($storagePath) && is_file($storagePath)) {
        $mimeTypes = [
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'gif' => 'image/gif',
            'webp' => 'image/webp',
            'pdf' => 'application/pdf',
            'txt' => 'text/plain',
            'zip' => 'application/zip',
            'mp3' => 'audio/mpeg',
            'wav' => 'audio/wav',
            'ogg' => 'audio/ogg',
        ];
        $ext = strtolower(pathinfo($storagePath, PATHINFO_EXTENSION));
        $contentType = $mimeTypes[$ext] ?? 'application/octet-stream';
        
        header('Content-Type: ' . $contentType);
        header('Content-Length: ' . filesize($storagePath));
        readfile($storagePath);
        exit;
    }
}

$router->dispatch($method, $uri);
