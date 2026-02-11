<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Core\Request;
use App\Core\Session;
use App\Core\Database;
use App\Models\TextChannel;
use App\Models\VoiceChannel;
use App\Models\Message;
use App\Models\Friendship;

class DmController extends BaseController
{
    private TextChannel $textChannelModel;
    private VoiceChannel $voiceChannelModel;
    private Message $messageModel;
    private Friendship $friendshipModel;

    public function __construct(Database $db)
    {
        parent::__construct($db);
        $this->textChannelModel = new TextChannel($db);
        $this->voiceChannelModel = new VoiceChannel($db);
        $this->messageModel = new Message($db);
        $this->friendshipModel = new Friendship($db);
    }

    /**
     * Get messages for a DM channel (reuses existing message infrastructure)
     */
    public function getMessages(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $channelId = (int)$request->param('id');
        $userId = Session::getUserId();

        // Verify channel is a DM and user is a participant
        $channel = $this->textChannelModel->find($channelId);
        if (!$channel || $channel['type'] !== 'dm') {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        if (!$this->textChannelModel->isChannelParticipant($channelId, $userId)) {
            $this->json(['error' => 'Access denied'], 403);
            return;
        }

        $limit = min((int)($request->query('limit') ?? 50), 100);
        $offset = (int)($request->query('offset') ?? 0);

        $messages = $this->messageModel->getChannelMessages($channelId, $limit, $offset);

        $this->json([
            'success' => true,
            'channel' => $channel,
            'messages' => array_reverse($messages)
        ]);
    }

    /**
     * Upload attachment in a DM channel (reuses same logic as ChannelController)
     */
    public function uploadAttachment(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $channelId = (int)$request->param('id');
        $userId = Session::getUserId();

        $channel = $this->textChannelModel->find($channelId);
        if (!$channel || $channel['type'] !== 'dm') {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        if (!$this->textChannelModel->isChannelParticipant($channelId, $userId)) {
            $this->json(['error' => 'Access denied'], 403);
            return;
        }

        $file = $request->file('file');
        $messageText = trim($request->post('message', ''));

        if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
            $this->json(['error' => 'No file uploaded or upload error'], 400);
            return;
        }

        $maxSize = 10 * 1024 * 1024;
        if ($file['size'] > $maxSize) {
            $this->json(['error' => 'File too large. Maximum size is 10MB'], 400);
            return;
        }

        $allowedMimes = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/gif' => 'gif',
            'image/webp' => 'webp',
            'application/pdf' => 'pdf',
            'text/plain' => 'txt',
            'application/zip' => 'zip',
            'application/x-zip-compressed' => 'zip'
        ];

        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mimeType = finfo_file($finfo, $file['tmp_name']);
        finfo_close($finfo);

        if (!isset($allowedMimes[$mimeType])) {
            $this->json(['error' => 'File type not allowed'], 400);
            return;
        }

        $isImage = str_starts_with($mimeType, 'image/');
        $attachmentType = $isImage ? 'image' : 'file';

        $extension = $allowedMimes[$mimeType];
        $filename = uniqid('attachment_', true) . '.' . $extension;
        $uploadDir = dirname(__DIR__, 3) . '/storage/attachments';

        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        $filepath = $uploadDir . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $filepath)) {
            $this->json(['error' => 'Failed to save file'], 500);
            return;
        }

        $attachmentUrl = '/storage/attachments/' . $filename;
        $originalName = $file['name'];

        $content = $messageText ?: '';
        $messageId = $this->messageModel->createMessage(
            $channelId,
            $userId,
            $content,
            $attachmentUrl,
            $attachmentType,
            $originalName
        );

        $message = $this->messageModel->getMessageWithUser($messageId);

        $this->json([
            'success' => true,
            'message' => $message
        ]);
    }

    /**
     * Get the DM voice channel for initiating a private call
     */
    public function getVoiceChannel(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $friendId = (int)$request->param('friendId');
        $userId = Session::getUserId();

        if (!$this->friendshipModel->areFriends($userId, $friendId)) {
            $this->json(['error' => 'You are not friends with this user'], 403);
            return;
        }

        $voiceChannel = $this->voiceChannelModel->getOrCreateDmVoiceChannel($userId, $friendId);
        $members = $this->voiceChannelModel->getMembers($voiceChannel['id']);

        $this->json([
            'success' => true,
            'voice_channel_id' => (int)$voiceChannel['id'],
            'voice_channel' => $voiceChannel,
            'members' => $members
        ]);
    }

    /**
     * Get list of DM conversations for the current user
     */
    public function listConversations(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = Session::getUserId();
        $friends = $this->friendshipModel->getFriends($userId);
        
        // Format conversations from friendships
        $conversations = array_map(function($f) {
            return [
                'channel_id' => (int)$f['dm_channel_id'],
                'friend_id' => (int)$f['friend_id'],
                'username' => $f['username'],
                'display_name' => $f['display_name'],
                'avatar' => $f['avatar'],
                'is_online' => ($f['status'] ?? 'offline') !== 'offline'
            ];
        }, $friends);

        $this->json(['success' => true, 'conversations' => $conversations]);
    }

    /**
     * Get the user's active DM voice call (if any)
     * This checks if there's any active call in a DM channel the user is part of
     */
    public function getActiveCall(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $userId = Session::getUserId();
        
        // Check if there's any active DM voice call for this user
        // This includes calls where only the friend is connected (user can rejoin)
        $activeCall = $this->voiceChannelModel->getAnyActiveDmCallForUser($userId);
        
        if (!$activeCall) {
            $this->json(['success' => true, 'active_call' => null]);
            return;
        }

        // Get friend info
        $friendId = $activeCall['participant_1'] == $userId 
            ? $activeCall['participant_2'] 
            : $activeCall['participant_1'];
        
        $members = $this->voiceChannelModel->getMembers($activeCall['id']);
        
        // Check if current user is in the call
        $userInCall = false;
        foreach ($members as $member) {
            if ($member['user_id'] == $userId) {
                $userInCall = true;
                break;
            }
        }
        
        $this->json([
            'success' => true,
            'active_call' => [
                'voice_channel_id' => (int)$activeCall['id'],
                'friend_id' => (int)$friendId,
                'members' => $members,
                'user_in_call' => $userInCall
            ]
        ]);
    }
}
