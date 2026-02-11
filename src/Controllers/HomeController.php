<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\Request;
use App\Core\Session;
use App\Core\Database;
use App\Models\TextChannel;
use App\Models\VoiceChannel;
use App\Models\Message;
use App\Models\Sound;
use App\Models\User;
use App\Models\Category;
use App\Models\Role;

class HomeController extends BaseController
{
    private TextChannel $textChannelModel;
    private VoiceChannel $voiceChannelModel;
    private Message $messageModel;
    private Sound $soundModel;
    private User $userModel;
    private Category $categoryModel;
    private Role $roleModel;

    public function __construct(Database $db)
    {
        parent::__construct($db);
        $this->textChannelModel = new TextChannel($db);
        $this->voiceChannelModel = new VoiceChannel($db);
        $this->messageModel = new Message($db);
        $this->soundModel = new Sound($db);
        $this->userModel = new User($db);
        $this->categoryModel = new Category($db);
        $this->roleModel = new Role($db);
    }

    public function index(Request $request): void
    {
        $this->requireAuth();

        // Get user permissions
        $userId = Session::getUserId();
        
        // Clean up: Remove current user from any voice channel on page load
        // This handles cases where the browser was closed without proper WebSocket disconnect
        $this->voiceChannelModel->removeMember($userId);

        $categories = $this->categoryModel->getAllWithChannels();
        $uncategorized = $this->categoryModel->getUncategorizedChannels();
        $sounds = $this->soundModel->getAllSounds();
        $allUsers = $this->userModel->getAllUsersWithStatus();
        
        $permissions = $this->roleModel->getUserPermissions($userId);
        $permissionNames = $this->roleModel->getUserPermissionNames($userId);
        $userProfile = $this->userModel->getUserProfile($userId);

        // Get all text channels for default selection
        $allTextChannels = $this->textChannelModel->getAllOrdered();
        
        // Default to first text channel if exists
        $activeChannelId = $request->query('channel', $allTextChannels[0]['id'] ?? null);
        $activeChannel = null;
        $messages = [];

        if ($activeChannelId) {
            $activeChannel = $this->textChannelModel->find((int)$activeChannelId);
            if ($activeChannel) {
                $messages = array_reverse($this->messageModel->getChannelMessages((int)$activeChannelId));
            }
        }

        $html = $this->render('app/index.twig', [
            'categories' => $categories,
            'uncategorized' => $uncategorized,
            'sounds' => $sounds,
            'allUsers' => $allUsers,
            'activeChannel' => $activeChannel,
            'messages' => $messages,
            'permissions' => $permissionNames,
            'userProfile' => $userProfile
        ]);

        $this->response->html($html);
    }
}
