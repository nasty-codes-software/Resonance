<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Core\Request;
use App\Core\Session;
use App\Core\Database;
use App\Models\FriendRequest;
use App\Models\Friendship;
use App\Models\User;

class FriendController extends BaseController
{
    private FriendRequest $friendRequestModel;
    private Friendship $friendshipModel;
    private User $userModel;

    public function __construct(Database $db)
    {
        parent::__construct($db);
        $this->friendRequestModel = new FriendRequest($db);
        $this->friendshipModel = new Friendship($db);
        $this->userModel = new User($db);
    }

    /**
     * Get all friends for the current user
     */
    public function list(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $friends = $this->friendshipModel->getFriends(Session::getUserId());
        
        // Add is_online flag for frontend
        $friends = array_map(function($f) {
            $f['is_online'] = ($f['status'] ?? 'offline') !== 'offline';
            return $f;
        }, $friends);

        $this->json(['success' => true, 'friends' => $friends]);
    }

    /**
     * Send a friend request by username
     */
    public function sendRequest(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $data = $request->json();
        $username = trim($data['username'] ?? '');

        if (empty($username)) {
            $this->json(['error' => 'Username is required'], 400);
            return;
        }

        $targetUser = $this->userModel->findByUsername($username);
        if (!$targetUser) {
            $this->json(['error' => 'User not found'], 404);
            return;
        }

        $senderId = Session::getUserId();

        if ($senderId === (int)$targetUser['id']) {
            $this->json(['error' => 'You cannot send a friend request to yourself'], 400);
            return;
        }

        if ($this->friendshipModel->areFriends($senderId, (int)$targetUser['id'])) {
            $this->json(['error' => 'You are already friends with this user'], 400);
            return;
        }

        $requestId = $this->friendRequestModel->sendRequest($senderId, (int)$targetUser['id']);

        if ($requestId === false) {
            $this->json(['error' => 'Friend request already pending'], 400);
            return;
        }

        $this->json([
            'success' => true,
            'request_id' => $requestId,
            'target_user_id' => (int)$targetUser['id'],
            'target_user' => [
                'id' => $targetUser['id'],
                'username' => $targetUser['username'],
                'display_name' => $targetUser['display_name'],
                'avatar' => $targetUser['avatar']
            ]
        ]);
    }

    /**
     * Accept a friend request
     */
    public function acceptRequest(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $requestId = (int)$request->param('id');
        
        // Get request before accepting (it will be marked as accepted)
        $friendRequest = $this->friendRequestModel->find($requestId);
        if (!$friendRequest) {
            $this->json(['error' => 'Friend request not found'], 404);
            return;
        }
        
        $result = $this->friendRequestModel->acceptRequest($requestId, Session::getUserId());

        if (!$result) {
            $this->json(['error' => 'Invalid or already processed request'], 400);
            return;
        }

        // Get the newly created friendship
        $friendship = $this->friendshipModel->getFriendship(
            $friendRequest['sender_id'],
            Session::getUserId()
        );

        $sender = $this->userModel->find($friendRequest['sender_id']);

        $this->json([
            'success' => true,
            'dm_channel_id' => $friendship['dm_channel_id'] ?? null,
            'voice_channel_id' => $friendship['voice_channel_id'] ?? null,
            'friend' => [
                'id' => $sender['id'],
                'username' => $sender['username'],
                'display_name' => $sender['display_name'],
                'avatar' => $sender['avatar'],
                'status' => $sender['status']
            ]
        ]);
    }

    /**
     * Decline a friend request
     */
    public function declineRequest(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $requestId = (int)$request->param('id');
        $result = $this->friendRequestModel->declineRequest($requestId, Session::getUserId());

        if (!$result) {
            $this->json(['error' => 'Invalid or already processed request'], 400);
            return;
        }

        $this->json(['success' => true]);
    }

    /**
     * Cancel a sent friend request
     */
    public function cancelRequest(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $requestId = (int)$request->param('id');
        $result = $this->friendRequestModel->cancelRequest($requestId, Session::getUserId());

        if (!$result) {
            $this->json(['error' => 'Invalid request'], 400);
            return;
        }

        $this->json(['success' => true]);
    }

    /**
     * Remove a friend
     */
    public function removeFriend(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $friendId = (int)$request->param('id');
        $result = $this->friendshipModel->removeFriendship(Session::getUserId(), $friendId);

        if (!$result) {
            $this->json(['error' => 'Friendship not found'], 404);
            return;
        }

        $this->json(['success' => true]);
    }

    /**
     * Get pending friend requests (received and sent)
     */
    public function pendingRequests(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = Session::getUserId();
        
        // Format incoming requests
        $received = $this->friendRequestModel->getPendingReceived($userId);
        $incoming = array_map(function($r) {
            return [
                'id' => $r['id'],
                'username' => $r['sender_username'],
                'display_name' => $r['sender_display_name'],
                'avatar' => $r['sender_avatar'],
                'created_at' => $r['created_at']
            ];
        }, $received);
        
        // Format outgoing requests
        $sent = $this->friendRequestModel->getPendingSent($userId);
        $outgoing = array_map(function($r) {
            return [
                'id' => $r['id'],
                'username' => $r['receiver_username'],
                'display_name' => $r['receiver_display_name'],
                'avatar' => $r['receiver_avatar'],
                'created_at' => $r['created_at']
            ];
        }, $sent);

        $this->json([
            'success' => true,
            'incoming' => $incoming,
            'outgoing' => $outgoing
        ]);
    }

    /**
     * Get or create DM channel with a friend
     */
    public function getDmChannel(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $friendId = (int)$request->param('id');
        $userId = Session::getUserId();

        if (!$this->friendshipModel->areFriends($userId, $friendId)) {
            $this->json(['error' => 'You are not friends with this user'], 403);
            return;
        }

        $friendship = $this->friendshipModel->getFriendship($userId, $friendId);
        $friend = $this->userModel->find($friendId);

        $this->json([
            'success' => true,
            'dm_channel_id' => (int)$friendship['dm_channel_id'],
            'voice_channel_id' => (int)$friendship['voice_channel_id'],
            'friend' => [
                'id' => $friend['id'],
                'username' => $friend['username'],
                'display_name' => $friend['display_name'],
                'avatar' => $friend['avatar'],
                'status' => $friend['status']
            ]
        ]);
    }
}
