<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Core\Request;
use App\Core\Session;
use App\Core\Database;
use App\Models\Message;
use App\Models\Role;
use App\Models\Permission;

class MessageController extends BaseController
{
    private Message $messageModel;
    private Role $roleModel;

    public function __construct(Database $db)
    {
        parent::__construct($db);
        $this->messageModel = new Message($db);
        $this->roleModel = new Role($db);
    }

    public function update(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $message = $this->messageModel->find($id);

        if (!$message) {
            $this->json(['error' => 'Message not found'], 404);
            return;
        }

        // Only message author can edit
        if ($message['user_id'] !== Session::getUserId()) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $data = $request->json();
        $content = trim($data['content'] ?? '');

        if (empty($content)) {
            $this->json(['error' => 'Message content is required'], 400);
            return;
        }

        $this->messageModel->updateContent($id, $content);

        $this->json([
            'success' => true,
            'message' => $this->messageModel->getMessageWithUser($id)
        ]);
    }

    public function delete(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $message = $this->messageModel->find($id);

        if (!$message) {
            $this->json(['error' => 'Message not found'], 404);
            return;
        }

        $userId = Session::getUserId();
        $isOwner = $message['user_id'] === $userId;
        $canManage = $this->roleModel->hasPermission($userId, Permission::MANAGE_MESSAGES);
        $isAdmin = $this->roleModel->hasPermission($userId, Permission::ADMINISTRATOR);

        if (!$isOwner && !$canManage && !$isAdmin) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $this->messageModel->delete($id);

        $this->json(['success' => true]);
    }

    public function togglePin(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $message = $this->messageModel->find($id);

        if (!$message) {
            $this->json(['error' => 'Message not found'], 404);
            return;
        }

        $userId = Session::getUserId();
        $canManage = $this->roleModel->hasPermission($userId, Permission::MANAGE_MESSAGES);
        $isAdmin = $this->roleModel->hasPermission($userId, Permission::ADMINISTRATOR);

        if (!$canManage && !$isAdmin) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $isPinned = (bool)$message['pinned'];

        if ($isPinned) {
            $this->messageModel->unpinMessage($id);
        } else {
            $this->messageModel->pinMessage($id);
        }

        $this->json([
            'success' => true,
            'pinned' => !$isPinned
        ]);
    }
}
