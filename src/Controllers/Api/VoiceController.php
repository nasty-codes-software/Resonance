<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Core\Request;
use App\Core\Session;
use App\Core\Database;
use App\Models\VoiceChannel;

class VoiceController extends BaseController
{
    private VoiceChannel $voiceChannelModel;

    public function __construct(Database $db)
    {
        parent::__construct($db);
        $this->voiceChannelModel = new VoiceChannel($db);
    }

    public function list(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
        }

        $channels = $this->voiceChannelModel->getAllWithMembers();
        $this->json(['channels' => $channels]);
    }

    public function create(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $data = $request->json();
        $name = trim($data['name'] ?? '');
        $maxUsers = (int)($data['max_users'] ?? 0);
        $categoryId = isset($data['category_id']) ? (int)$data['category_id'] : null;

        if (empty($name)) {
            $this->json(['error' => 'Channel name is required'], 400);
            return;
        }

        if (strlen($name) > 100) {
            $this->json(['error' => 'Channel name is too long'], 400);
            return;
        }

        $channelId = $this->voiceChannelModel->createChannel(
            $name,
            Session::getUserId(),
            $maxUsers,
            $categoryId
        );

        $channel = $this->voiceChannelModel->find($channelId);

        $this->json([
            'success' => true,
            'channel' => $channel
        ]);
    }

    public function get(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $channel = $this->voiceChannelModel->find($id);

        if (!$channel) {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        $this->json(['channel' => $channel]);
    }

    public function update(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $channel = $this->voiceChannelModel->find($id);

        if (!$channel) {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        // Only admin or channel creator can update
        if (!Session::isAdmin() && $channel['created_by'] !== Session::getUserId()) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $data = $request->json();
        $updateData = [];

        if (isset($data['name'])) {
            $name = trim($data['name']);
            if (!empty($name)) {
                $updateData['name'] = $name;
            }
        }

        if (isset($data['max_users'])) {
            $updateData['max_users'] = max(0, (int)$data['max_users']);
        }

        if (isset($data['category_id'])) {
            $updateData['category_id'] = $data['category_id'] ? (int)$data['category_id'] : null;
        }

        if (!empty($updateData)) {
            $this->voiceChannelModel->update($id, $updateData);
        }

        $this->json(['success' => true, 'channel' => $this->voiceChannelModel->find($id)]);
    }

    public function delete(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $channel = $this->voiceChannelModel->find($id);

        if (!$channel) {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        // Only admin or channel creator can delete
        if (!Session::isAdmin() && $channel['created_by'] !== Session::getUserId()) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $this->voiceChannelModel->delete($id);

        $this->json(['success' => true]);
    }

    public function join(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $channel = $this->voiceChannelModel->find($id);

        if (!$channel) {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        // Check max users
        if ($channel['max_users'] > 0) {
            $members = $this->voiceChannelModel->getMembers($id);
            if (count($members) >= $channel['max_users']) {
                $this->json(['error' => 'Channel is full'], 400);
                return;
            }
        }

        $this->voiceChannelModel->addMember($id, Session::getUserId());

        $this->json([
            'success' => true,
            'channel' => $this->voiceChannelModel->find($id),
            'members' => $this->voiceChannelModel->getMembers($id)
        ]);
    }

    public function leave(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
        }

        $this->voiceChannelModel->removeMember(Session::getUserId());

        $this->json(['success' => true]);
    }

    public function getMembers(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $channel = $this->voiceChannelModel->find($id);

        if (!$channel) {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        $members = $this->voiceChannelModel->getMembers($id);

        $this->json([
            'channel' => $channel,
            'members' => $members
        ]);
    }

    public function disconnectMember(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        // Check if user has permission to move/disconnect members
        $roleModel = new \App\Models\Role($this->db);
        $hasPermission = $roleModel->hasAnyPermission(Session::getUserId(), [
            \App\Models\Permission::MOVE_MEMBERS,
            \App\Models\Permission::ADMINISTRATOR
        ]);

        if (!$hasPermission) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        $userId = (int)$request->param('userId');
        
        if (!$userId) {
            $this->json(['error' => 'User ID is required'], 400);
            return;
        }

        $this->voiceChannelModel->removeMember($userId);

        $this->json(['success' => true, 'user_id' => $userId]);
    }
}
