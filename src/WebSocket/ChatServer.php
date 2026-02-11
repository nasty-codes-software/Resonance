<?php

declare(strict_types=1);

namespace App\WebSocket;

use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;
use App\Core\Database;
use App\Models\Message;
use App\Models\VoiceChannel;
use App\Models\TextChannel;
use App\Models\User;
use App\Models\Role;
use App\Models\Friendship;

class ChatServer implements MessageComponentInterface
{
    protected \SplObjectStorage $clients;
    protected array $users = [];        // conn resourceId => user data (without connection object)
    protected array $connections = [];  // conn resourceId => ConnectionInterface
    protected array $channels = [];     // channel_id => [resourceId1, resourceId2, ...]
    protected array $voiceRooms = [];   // voice_channel_id => [resourceId1, resourceId2, ...]
    protected array $dmChannels = [];   // dm_channel_id => [resourceId1, resourceId2]
    protected Database $db;
    protected Message $messageModel;
    protected VoiceChannel $voiceChannelModel;
    protected TextChannel $textChannelModel;
    protected User $userModel;
    protected Role $roleModel;
    protected Friendship $friendshipModel;

    public function __construct()
    {
        $this->clients = new \SplObjectStorage();
        $this->db = new Database();
        $this->messageModel = new Message($this->db);
        $this->voiceChannelModel = new VoiceChannel($this->db);
        $this->textChannelModel = new TextChannel($this->db);
        $this->userModel = new User($this->db);
        $this->roleModel = new Role($this->db);
        $this->friendshipModel = new Friendship($this->db);
        
        echo "Chat server initialized\n";
    }

    public function onOpen(ConnectionInterface $conn): void
    {
        $this->clients->attach($conn);
        $this->connections[$conn->resourceId] = $conn;
        echo "New connection: {$conn->resourceId} (total: {$this->clients->count()})\n";
    }

    public function onMessage(ConnectionInterface $from, $msg): void
    {
        $data = json_decode($msg, true);
        
        if (!$data || !isset($data['type'])) {
            return;
        }

        switch ($data['type']) {
            case 'auth':
                $this->handleAuth($from, $data);
                break;
            case 'chat_message':
                $this->handleChatMessage($from, $data);
                break;
            case 'dm_message':
                $this->handleDmMessage($from, $data);
                break;
            case 'join_channel':
                $this->handleJoinChannel($from, $data);
                break;
            case 'leave_channel':
                $this->handleLeaveChannel($from, $data);
                break;
            case 'join_dm':
                $this->handleJoinDm($from, $data);
                break;
            case 'leave_dm':
                $this->handleLeaveDm($from, $data);
                break;
            case 'join_voice':
                $this->handleJoinVoice($from, $data);
                break;
            case 'leave_voice':
                $this->handleLeaveVoice($from, $data);
                break;
            case 'join_dm_voice':
                $this->handleJoinDmVoice($from, $data);
                break;
            case 'force_disconnect_voice':
                $this->handleForceDisconnectVoice($from, $data);
                break;
            case 'webrtc_offer':
            case 'webrtc_answer':
            case 'webrtc_ice':
                $this->handleWebRTCSignaling($from, $data);
                break;
            case 'play_sound':
                $this->handlePlaySound($from, $data);
                break;
            case 'typing':
                $this->handleTyping($from, $data);
                break;
            case 'dm_typing':
                $this->handleDmTyping($from, $data);
                break;
            case 'speaking':
                $this->handleSpeaking($from, $data);
                break;
            case 'camera_state':
                $this->handleCameraState($from, $data);
                break;
            case 'screen_share_state':
                $this->handleScreenShareState($from, $data);
                break;
            case 'friend_request':
                $this->handleFriendRequest($from, $data);
                break;
            case 'friend_request_response':
                $this->handleFriendRequestResponse($from, $data);
                break;
            case 'dm_call_invite':
                $this->handleDmCallInvite($from, $data);
                break;
            case 'dm_call_response':
                $this->handleDmCallResponse($from, $data);
                break;
            default:
                echo "Unknown message type: {$data['type']}\n";
        }
    }

    public function onClose(ConnectionInterface $conn): void
    {
        $resourceId = $conn->resourceId;

        // Clean up user data
        if (isset($this->users[$resourceId])) {
            $user = $this->users[$resourceId];
            
            // Check if this user has another active connection (page reload scenario)
            $hasOtherConnection = false;
            foreach ($this->users as $rid => $userData) {
                if ($rid !== $resourceId && $userData['id'] === $user['id']) {
                    $hasOtherConnection = true;
                    break;
                }
            }
            
            // Leave all channels and remove empty channel entries
            foreach ($this->channels as $channelId => $members) {
                $filtered = array_filter($members, fn($rid) => $rid !== $resourceId);
                if (empty($filtered)) {
                    unset($this->channels[$channelId]);
                } else {
                    $this->channels[$channelId] = array_values($filtered);
                }
            }

            // Leave DM channels
            foreach ($this->dmChannels as $dmId => $members) {
                $filtered = array_filter($members, fn($rid) => $rid !== $resourceId);
                if (empty($filtered)) {
                    unset($this->dmChannels[$dmId]);
                } else {
                    $this->dmChannels[$dmId] = array_values($filtered);
                }
            }
            
            // Leave voice room
            $this->handleLeaveVoice($conn, []);
            
            if (!$hasOtherConnection) {
                // Only mark offline and broadcast if no other connection exists
                $this->userModel->setOffline($user['id']);
                
                $this->broadcast([
                    'type' => 'user_offline',
                    'user_id' => $user['id'],
                    'username' => $user['username']
                ]);

                // Notify friends specifically
                $this->notifyFriendsStatus($user['id'], 'offline');
            }
            
            unset($this->users[$resourceId]);
        }

        // Remove connection tracking
        unset($this->connections[$resourceId]);
        if ($this->clients->contains($conn)) {
            $this->clients->detach($conn);
        }

        echo "Connection closed: {$resourceId} (remaining: {$this->clients->count()}, users: " . count($this->users) . ", channels: " . count($this->channels) . ", voiceRooms: " . count($this->voiceRooms) . ")\n";
    }

    public function onError(ConnectionInterface $conn, \Exception $e): void
    {
        echo "Error: {$e->getMessage()}\n";
        $conn->close();
    }

    protected function handleAuth(ConnectionInterface $conn, array $data): void
    {
        $userId = (int)($data['user_id'] ?? 0);
        $sessionToken = $data['session_token'] ?? '';
        
        if (!$userId) {
            $conn->send(json_encode(['type' => 'auth_error', 'message' => 'Invalid user']));
            return;
        }

        $user = $this->userModel->find($userId);
        
        if (!$user) {
            $conn->send(json_encode(['type' => 'auth_error', 'message' => 'User not found']));
            return;
        }

        // Close any existing connection for this user (handles page reload race condition)
        $this->cleanupExistingUserConnections($userId, $conn->resourceId);

        // Store user data (connection tracked separately in $this->connections)
        $this->users[$conn->resourceId] = [
            'id' => $user['id'],
            'username' => $user['username'],
            'avatar' => $user['avatar']
        ];

        // Set user online
        $this->userModel->setOnline($user['id']);

        $conn->send(json_encode([
            'type' => 'auth_success',
            'user' => $this->userModel->toPublic($user)
        ]));

        // Broadcast user online
        $this->broadcast([
            'type' => 'user_online',
            'user_id' => $user['id'],
            'username' => $user['username']
        ], $conn);

        // Notify friends specifically
        $this->notifyFriendsStatus($user['id'], 'online');

        echo "User authenticated: {$user['username']}\n";
    }

    /**
     * Notify all online friends of a user's status change
     */
    protected function notifyFriendsStatus(int $userId, string $status): void
    {
        $friends = $this->friendshipModel->getFriends($userId);
        $user = $this->userModel->find($userId);

        foreach ($friends as $friend) {
            $friendConn = $this->findUserConnection((int)$friend['friend_id']);
            if ($friendConn) {
                $friendConn->send(json_encode([
                    'type' => 'friend_status_update',
                    'user_id' => $userId,
                    'username' => $user['username'],
                    'status' => $status
                ]));
            }
        }
    }

    protected function handleChatMessage(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $user = $this->users[$from->resourceId];
        $channelId = (int)($data['channel_id'] ?? 0);
        $content = trim($data['content'] ?? '');

        if (!$channelId || empty($content)) {
            return;
        }

        // Save message to database
        $messageId = $this->messageModel->createMessage($channelId, $user['id'], $content);
        $message = $this->messageModel->getMessageWithUser($messageId);

        // Broadcast to channel subscribers
        $this->broadcastToChannel($channelId, [
            'type' => 'new_message',
            'message' => $message
        ]);
    }

    /**
     * Handle DM messages (same as chat but for DM channels)
     */
    protected function handleDmMessage(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $user = $this->users[$from->resourceId];
        $channelId = (int)($data['channel_id'] ?? 0);
        $content = trim($data['content'] ?? '');

        if (!$channelId || empty($content)) {
            return;
        }

        // Verify user is participant
        if (!$this->textChannelModel->isChannelParticipant($channelId, $user['id'])) {
            return;
        }

        // Save message to database (uses same messages table)
        $messageId = $this->messageModel->createMessage($channelId, $user['id'], $content);
        $message = $this->messageModel->getMessageWithUser($messageId);

        // Broadcast to DM subscribers
        $this->broadcastToDm($channelId, [
            'type' => 'dm_new_message',
            'message' => $message,
            'channel_id' => $channelId
        ]);
    }

    protected function handleJoinChannel(ConnectionInterface $conn, array $data): void
    {
        $channelId = (int)($data['channel_id'] ?? 0);
        
        if (!$channelId) {
            return;
        }

        if (!isset($this->channels[$channelId])) {
            $this->channels[$channelId] = [];
        }

        // Store resourceId instead of connection object, avoid duplicates
        if (!in_array($conn->resourceId, $this->channels[$channelId], true)) {
            $this->channels[$channelId][] = $conn->resourceId;
        }

        $conn->send(json_encode([
            'type' => 'channel_joined',
            'channel_id' => $channelId
        ]));
    }

    protected function handleLeaveChannel(ConnectionInterface $conn, array $data): void
    {
        $channelId = (int)($data['channel_id'] ?? 0);
        
        if ($channelId && isset($this->channels[$channelId])) {
            $this->channels[$channelId] = array_values(array_filter(
                $this->channels[$channelId],
                fn($rid) => $rid !== $conn->resourceId
            ));
            // Remove empty channel entry
            if (empty($this->channels[$channelId])) {
                unset($this->channels[$channelId]);
            }
        }
    }

    /**
     * Handle joining a DM channel (for receiving messages)
     */
    protected function handleJoinDm(ConnectionInterface $conn, array $data): void
    {
        if (!isset($this->users[$conn->resourceId])) {
            return;
        }

        $channelId = (int)($data['channel_id'] ?? 0);
        $userId = $this->users[$conn->resourceId]['id'];
        
        if (!$channelId) {
            return;
        }

        // Verify user is participant
        if (!$this->textChannelModel->isChannelParticipant($channelId, $userId)) {
            $conn->send(json_encode(['type' => 'error', 'message' => 'Access denied']));
            return;
        }

        if (!isset($this->dmChannels[$channelId])) {
            $this->dmChannels[$channelId] = [];
        }

        if (!in_array($conn->resourceId, $this->dmChannels[$channelId], true)) {
            $this->dmChannels[$channelId][] = $conn->resourceId;
        }

        $conn->send(json_encode([
            'type' => 'dm_joined',
            'channel_id' => $channelId
        ]));
    }

    /**
     * Handle leaving a DM channel
     */
    protected function handleLeaveDm(ConnectionInterface $conn, array $data): void
    {
        $channelId = (int)($data['channel_id'] ?? 0);
        
        if ($channelId && isset($this->dmChannels[$channelId])) {
            $this->dmChannels[$channelId] = array_values(array_filter(
                $this->dmChannels[$channelId],
                fn($rid) => $rid !== $conn->resourceId
            ));
            if (empty($this->dmChannels[$channelId])) {
                unset($this->dmChannels[$channelId]);
            }
        }
    }

    protected function handleJoinVoice(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $user = $this->users[$from->resourceId];
        $channelId = (int)($data['channel_id'] ?? 0);

        if (!$channelId) {
            return;
        }

        // Leave any current voice room
        $this->handleLeaveVoice($from, []);

        // Join new voice room
        if (!isset($this->voiceRooms[$channelId])) {
            $this->voiceRooms[$channelId] = [];
        }

        // Get existing members before joining
        $existingMembers = [];
        foreach ($this->voiceRooms[$channelId] as $rid) {
            if (isset($this->users[$rid])) {
                $memberData = $this->users[$rid];
                $memberData['screen_sharing'] = $memberData['screen_sharing'] ?? false;
                $existingMembers[] = $memberData;
            }
        }

        $this->voiceRooms[$channelId][] = $from->resourceId;

        // Update database
        $this->voiceChannelModel->addMember($channelId, $user['id']);

        // Get channel info
        $channel = $this->voiceChannelModel->find($channelId);

        // Send existing members to new user
        $from->send(json_encode([
            'type' => 'voice_joined',
            'channel_id' => $channelId,
            'channel_name' => $channel['name'] ?? 'Voice',
            'channel_type' => $channel['type'] ?? 'public',
            'members' => $existingMembers
        ]));

        // Broadcast new member to existing members
        $this->broadcastToVoice($channelId, [
            'type' => 'voice_user_joined',
            'channel_id' => $channelId,
            'user' => [
                'id' => $user['id'],
                'username' => $user['username'],
                'avatar' => $user['avatar'] ?? null
            ]
        ], $from);

        // Only broadcast global update for public channels, not DM calls
        $channelData = $this->voiceChannelModel->find($channelId);
        if (!$channelData || $channelData['type'] !== 'dm') {
            $this->broadcast([
                'type' => 'voice_state_update',
                'channel_id' => $channelId,
                'user_id' => $user['id'],
                'username' => $user['username'],
                'avatar' => $user['avatar'] ?? null,
                'action' => 'join'
            ]);
        }
    }

    /**
     * Handle joining a DM voice channel (private call)
     */
    protected function handleJoinDmVoice(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $user = $this->users[$from->resourceId];
        $channelId = (int)($data['channel_id'] ?? 0);
        $targetUserId = (int)($data['target_user_id'] ?? 0);

        if (!$channelId) {
            return;
        }

        // Verify user is participant
        if (!$this->voiceChannelModel->isChannelParticipant($channelId, $user['id'])) {
            $from->send(json_encode(['type' => 'error', 'message' => 'Access denied']));
            return;
        }

        // Check max users (2 for DM)
        $channel = $this->voiceChannelModel->find($channelId);
        if ($channel && $channel['type'] === 'dm' && $channel['max_users'] > 0) {
            $currentMembers = isset($this->voiceRooms[$channelId]) ? count($this->voiceRooms[$channelId]) : 0;
            if ($currentMembers >= $channel['max_users']) {
                $from->send(json_encode(['type' => 'error', 'message' => 'Call is full']));
                return;
            }
        }

        // Leave any current voice room first
        $this->handleLeaveVoice($from, []);

        // Join DM voice room
        if (!isset($this->voiceRooms[$channelId])) {
            $this->voiceRooms[$channelId] = [];
        }

        // Get existing members before joining
        $existingMembers = [];
        foreach ($this->voiceRooms[$channelId] as $rid) {
            if (isset($this->users[$rid])) {
                $memberData = $this->users[$rid];
                $memberData['screen_sharing'] = $memberData['screen_sharing'] ?? false;
                $existingMembers[] = $memberData;
            }
        }

        $this->voiceRooms[$channelId][] = $from->resourceId;

        // Update database
        $this->voiceChannelModel->addMember($channelId, $user['id']);

        // Send voice joined confirmation to the user
        $from->send(json_encode([
            'type' => 'voice_joined',
            'channel_id' => $channelId,
            'channel_name' => 'Private Call',
            'channel_type' => 'dm',
            'members' => $existingMembers
        ]));

        // Broadcast to other members in the DM voice channel only (NOT globally)
        $this->broadcastToVoice($channelId, [
            'type' => 'voice_user_joined',
            'channel_id' => $channelId,
            'channel_type' => 'dm',
            'user' => [
                'id' => $user['id'],
                'username' => $user['username'],
                'avatar' => $user['avatar'] ?? null
            ]
        ], $from);

        // DO NOT broadcast global voice_state_update for DM calls
    }

    protected function handleLeaveVoice(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $user = $this->users[$from->resourceId];
        $leftChannel = null;

        foreach ($this->voiceRooms as $channelId => $members) {
            $key = array_search($from->resourceId, $members, true);
            if ($key !== false) {
                unset($this->voiceRooms[$channelId][$key]);
                $this->voiceRooms[$channelId] = array_values($this->voiceRooms[$channelId]);
                // Remove empty voice room entry
                if (empty($this->voiceRooms[$channelId])) {
                    unset($this->voiceRooms[$channelId]);
                }
                $leftChannel = $channelId;
                break;
            }
        }

        if ($leftChannel) {
            // Update database
            $this->voiceChannelModel->removeMember($user['id']);

            // Get channel to check type
            $leftChannelData = $this->voiceChannelModel->find($leftChannel);
            $isDmChannel = $leftChannelData && $leftChannelData['type'] === 'dm';

            // Notify others in voice room
            $this->broadcastToVoice($leftChannel, [
                'type' => 'voice_user_left',
                'channel_id' => $leftChannel,
                'channel_type' => $isDmChannel ? 'dm' : 'public',
                'user_id' => $user['id']
            ]);

            // If this was a DM channel and now empty, notify both participants that call ended
            if ($isDmChannel) {
                $remainingMembers = $this->voiceChannelModel->getMembers($leftChannel);
                if (empty($remainingMembers)) {
                    // Get both participants of this DM voice channel
                    $participants = $this->db->fetchAll(
                        "SELECT user_id FROM channel_participants WHERE channel_id = ? AND channel_type = 'voice'",
                        [$leftChannel]
                    );
                    
                    // Notify all participants that the call has ended
                    foreach ($participants as $participant) {
                        $participantId = $participant['user_id'];
                        foreach ($this->users as $resourceId => $connUser) {
                            if ($connUser['id'] == $participantId && isset($this->connections[$resourceId])) {
                                $this->connections[$resourceId]->send(json_encode([
                                    'type' => 'dm_call_ended',
                                    'channel_id' => $leftChannel
                                ]));
                            }
                        }
                    }
                }
            }

            // Only broadcast global update for public channels, not DM calls
            if (!$isDmChannel) {
                $this->broadcast([
                    'type' => 'voice_state_update',
                    'channel_id' => $leftChannel,
                    'user_id' => $user['id'],
                    'action' => 'leave'
                ]);
            }
        }

        $from->send(json_encode([
            'type' => 'voice_left'
        ]));
    }

    protected function handleForceDisconnectVoice(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $targetUserId = (int)($data['target_user_id'] ?? 0);
        $fromUser = $this->users[$from->resourceId];

        echo "Force disconnect request from {$fromUser['username']} for user ID: {$targetUserId}\n";

        if (!$targetUserId) {
            return;
        }

        // Check if user has permission (move_members or administrator)
        $hasPermission = $this->roleModel->hasAnyPermission($fromUser['id'], [
            \App\Models\Permission::MOVE_MEMBERS,
            \App\Models\Permission::ADMINISTRATOR
        ]);

        if (!$hasPermission) {
            echo "Permission denied for {$fromUser['username']}\n";
            $from->send(json_encode([
                'type' => 'error',
                'message' => 'Permission denied'
            ]));
            return;
        }

        // Find target user's connection first
        $targetConnection = null;
        foreach ($this->users as $resourceId => $userData) {
            if ($userData['id'] === $targetUserId && isset($this->connections[$resourceId])) {
                $targetConnection = $this->connections[$resourceId];
                echo "Found target connection for user ID: {$targetUserId}\n";
                break;
            }
        }

        // Find which voice channel the target user is in and remove them
        $leftChannel = null;

        foreach ($this->voiceRooms as $channelId => $members) {
            foreach ($members as $key => $rid) {
                if (isset($this->users[$rid]) && $this->users[$rid]['id'] === $targetUserId) {
                    unset($this->voiceRooms[$channelId][$key]);
                    $this->voiceRooms[$channelId] = array_values($this->voiceRooms[$channelId]);
                    // Remove empty voice room entry
                    if (empty($this->voiceRooms[$channelId])) {
                        unset($this->voiceRooms[$channelId]);
                    }
                    $leftChannel = $channelId;
                    echo "Removed user {$targetUserId} from voice channel {$channelId}\n";
                    break 2;
                }
            }
        }

        if ($leftChannel) {
            // Notify target user FIRST (before broadcasting to others)
            if ($targetConnection) {
                echo "Sending force_disconnected to user {$targetUserId}\n";
                $targetConnection->send(json_encode([
                    'type' => 'voice_force_disconnected',
                    'message' => 'You have been disconnected from voice by ' . $fromUser['username']
                ]));
            }

            // Notify others in voice room
            $this->broadcastToVoice($leftChannel, [
                'type' => 'voice_user_left',
                'channel_id' => $leftChannel,
                'user_id' => $targetUserId
            ]);

            // Broadcast to all for UI update (sidebar)
            $this->broadcast([
                'type' => 'voice_state_update',
                'channel_id' => $leftChannel,
                'user_id' => $targetUserId,
                'action' => 'leave'
            ]);
        } else {
            echo "User {$targetUserId} not found in any voice channel\n";
        }
    }

    protected function handleWebRTCSignaling(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $targetUserId = (int)($data['target_user_id'] ?? 0);
        $fromUser = $this->users[$from->resourceId];

        if (!$targetUserId) {
            return;
        }

        // Find target connection
        foreach ($this->users as $resourceId => $userData) {
            if ($userData['id'] === $targetUserId && isset($this->connections[$resourceId])) {
                $this->connections[$resourceId]->send(json_encode([
                    'type' => $data['type'],
                    'from_user_id' => $fromUser['id'],
                    'payload' => $data['payload'] ?? null
                ]));
                break;
            }
        }
    }

    protected function handlePlaySound(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $user = $this->users[$from->resourceId];
        $soundId = (int)($data['sound_id'] ?? 0);
        $channelId = (int)($data['channel_id'] ?? 0);

        if (!$soundId || !$channelId) {
            return;
        }

        // Broadcast to all voice channel members
        $this->broadcastToVoice($channelId, [
            'type' => 'play_sound',
            'sound_id' => $soundId,
            'triggered_by' => $user['username']
        ]);
    }

    protected function handleTyping(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $user = $this->users[$from->resourceId];
        $channelId = (int)($data['channel_id'] ?? 0);

        if (!$channelId) {
            return;
        }

        $this->broadcastToChannel($channelId, [
            'type' => 'user_typing',
            'channel_id' => $channelId,
            'user_id' => $user['id'],
            'username' => $user['username']
        ], $from);
    }

    /**
     * Handle typing in DM
     */
    protected function handleDmTyping(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $user = $this->users[$from->resourceId];
        $channelId = (int)($data['channel_id'] ?? 0);

        if (!$channelId) {
            return;
        }

        $this->broadcastToDm($channelId, [
            'type' => 'dm_user_typing',
            'channel_id' => $channelId,
            'user_id' => $user['id'],
            'username' => $user['username']
        ], $from);
    }

    protected function handleSpeaking(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $user = $this->users[$from->resourceId];
        $speaking = (bool)($data['speaking'] ?? false);

        // Find which voice room the user is in
        $voiceChannelId = $this->findUserVoiceChannel($from->resourceId);

        if (!$voiceChannelId) {
            return;
        }

        // Broadcast speaking state to all users in the voice channel
        $this->broadcastToVoice($voiceChannelId, [
            'type' => 'user_speaking',
            'user_id' => $user['id'],
            'username' => $user['username'],
            'speaking' => $speaking
        ]);
    }

    protected function handleCameraState(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $user = $this->users[$from->resourceId];
        $cameraOn = (bool)($data['camera_on'] ?? false);

        // Find which voice room the user is in
        $voiceChannelId = $this->findUserVoiceChannel($from->resourceId);

        if (!$voiceChannelId) {
            return;
        }

        // Broadcast camera state to all users in the voice channel
        $this->broadcastToVoice($voiceChannelId, [
            'type' => 'user_camera_state',
            'user_id' => $user['id'],
            'username' => $user['username'],
            'camera_on' => $cameraOn
        ]);
    }

    protected function handleScreenShareState(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $user = $this->users[$from->resourceId];
        $screenSharing = (bool)($data['screen_sharing'] ?? false);

        // Find which voice room the user is in
        $voiceChannelId = $this->findUserVoiceChannel($from->resourceId);

        if (!$voiceChannelId) {
            return;
        }

        // Store screen share state on user for new joiners
        $this->users[$from->resourceId]['screen_sharing'] = $screenSharing;

        // Broadcast screen share state to ALL users in the voice channel (including sender)
        $this->broadcastToVoice($voiceChannelId, [
            'type' => 'user_screen_share_state',
            'user_id' => $user['id'],
            'username' => $user['username'],
            'screen_sharing' => $screenSharing
        ]);
    }

    /**
     * Handle friend request notification (relay to target user if online)
     */
    protected function handleFriendRequest(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $fromUser = $this->users[$from->resourceId];
        $targetUserId = (int)($data['target_user_id'] ?? 0);

        if (!$targetUserId) {
            return;
        }

        $targetConn = $this->findUserConnection($targetUserId);
        if ($targetConn) {
            $targetConn->send(json_encode([
                'type' => 'friend_request_received',
                'request_id' => $data['request_id'] ?? 0,
                'from_user' => [
                    'id' => $fromUser['id'],
                    'username' => $fromUser['username'],
                    'avatar' => $fromUser['avatar']
                ]
            ]));
        }
    }

    /**
     * Handle friend request response (accept/decline notification)
     */
    protected function handleFriendRequestResponse(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $fromUser = $this->users[$from->resourceId];
        $targetUserId = (int)($data['target_user_id'] ?? 0);
        $accepted = (bool)($data['accepted'] ?? false);

        if (!$targetUserId) {
            return;
        }

        $targetConn = $this->findUserConnection($targetUserId);
        if ($targetConn) {
            if ($accepted) {
                $targetConn->send(json_encode([
                    'type' => 'friend_request_accepted',
                    'by_user' => [
                        'id' => $fromUser['id'],
                        'username' => $fromUser['username'],
                        'avatar' => $fromUser['avatar']
                    ],
                    'dm_channel_id' => $data['dm_channel_id'] ?? null,
                    'voice_channel_id' => $data['voice_channel_id'] ?? null
                ]));
            }
        }
    }

    /**
     * Handle DM call invite
     */
    protected function handleDmCallInvite(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $fromUser = $this->users[$from->resourceId];
        $targetUserId = (int)($data['target_user_id'] ?? 0);
        $voiceChannelId = (int)($data['voice_channel_id'] ?? 0);
        $hasVideo = (bool)($data['has_video'] ?? false);

        if (!$targetUserId || !$voiceChannelId) {
            return;
        }

        // Verify they are friends
        if (!$this->friendshipModel->areFriends($fromUser['id'], $targetUserId)) {
            $from->send(json_encode(['type' => 'error', 'message' => 'You must be friends to call']));
            return;
        }

        $targetConn = $this->findUserConnection($targetUserId);
        if ($targetConn) {
            $targetConn->send(json_encode([
                'type' => 'dm_call_incoming',
                'voice_channel_id' => $voiceChannelId,
                'has_video' => $hasVideo,
                'from_user' => [
                    'id' => $fromUser['id'],
                    'username' => $fromUser['username'],
                    'avatar' => $fromUser['avatar']
                ]
            ]));
        } else {
            // User is offline
            $from->send(json_encode([
                'type' => 'dm_call_unavailable',
                'target_user_id' => $targetUserId,
                'reason' => 'User is offline'
            ]));
        }
    }

    /**
     * Handle DM call response (accept/decline)
     */
    protected function handleDmCallResponse(ConnectionInterface $from, array $data): void
    {
        if (!isset($this->users[$from->resourceId])) {
            return;
        }

        $fromUser = $this->users[$from->resourceId];
        $targetUserId = (int)($data['target_user_id'] ?? 0);
        $accepted = (bool)($data['accepted'] ?? false);
        $voiceChannelId = (int)($data['voice_channel_id'] ?? 0);

        if (!$targetUserId) {
            return;
        }

        $targetConn = $this->findUserConnection($targetUserId);
        if ($targetConn) {
            $targetConn->send(json_encode([
                'type' => $accepted ? 'dm_call_accepted' : 'dm_call_declined',
                'voice_channel_id' => $voiceChannelId,
                'by_user' => [
                    'id' => $fromUser['id'],
                    'username' => $fromUser['username']
                ]
            ]));
        }
    }

    protected function broadcast(array $message, ?ConnectionInterface $exclude = null): void
    {
        $payload = json_encode($message);
        
        foreach ($this->clients as $client) {
            if ($client !== $exclude) {
                $client->send($payload);
            }
        }
    }

    protected function broadcastToChannel(int $channelId, array $message, ?ConnectionInterface $exclude = null): void
    {
        if (!isset($this->channels[$channelId])) {
            return;
        }

        $payload = json_encode($message);
        $excludeId = $exclude ? $exclude->resourceId : null;
        
        foreach ($this->channels[$channelId] as $resourceId) {
            if ($resourceId !== $excludeId && isset($this->connections[$resourceId])) {
                $this->connections[$resourceId]->send($payload);
            }
        }
    }

    /**
     * Broadcast to DM channel subscribers
     */
    protected function broadcastToDm(int $channelId, array $message, ?ConnectionInterface $exclude = null): void
    {
        if (!isset($this->dmChannels[$channelId])) {
            return;
        }

        $payload = json_encode($message);
        $excludeId = $exclude ? $exclude->resourceId : null;
        
        foreach ($this->dmChannels[$channelId] as $resourceId) {
            if ($resourceId !== $excludeId && isset($this->connections[$resourceId])) {
                $this->connections[$resourceId]->send($payload);
            }
        }
    }

    protected function broadcastToVoice(int $channelId, array $message, ?ConnectionInterface $exclude = null): void
    {
        if (!isset($this->voiceRooms[$channelId])) {
            return;
        }

        $payload = json_encode($message);
        $excludeId = $exclude ? $exclude->resourceId : null;
        
        foreach ($this->voiceRooms[$channelId] as $resourceId) {
            if ($resourceId !== $excludeId && isset($this->connections[$resourceId])) {
                $this->connections[$resourceId]->send($payload);
            }
        }
    }

    /**
     * Find which voice channel a user (by resourceId) is in.
     */
    protected function findUserVoiceChannel(int $resourceId): ?int
    {
        foreach ($this->voiceRooms as $channelId => $members) {
            if (in_array($resourceId, $members, true)) {
                return $channelId;
            }
        }
        return null;
    }

    /**
     * Find a user's connection by user ID
     */
    protected function findUserConnection(int $userId): ?ConnectionInterface
    {
        foreach ($this->users as $resourceId => $userData) {
            if ($userData['id'] === $userId && isset($this->connections[$resourceId])) {
                return $this->connections[$resourceId];
            }
        }
        return null;
    }

    /**
     * Clean up any existing connections for a user (handles page reload race condition).
     * When a user reloads the page, the new WebSocket may connect before the old one closes.
     * This ensures only one connection per user exists.
     */
    protected function cleanupExistingUserConnections(int $userId, int $excludeResourceId): void
    {
        $staleResourceIds = [];

        foreach ($this->users as $resourceId => $userData) {
            if ($userData['id'] === $userId && $resourceId !== $excludeResourceId) {
                $staleResourceIds[] = $resourceId;
            }
        }

        foreach ($staleResourceIds as $resourceId) {
            echo "Cleaning up stale connection {$resourceId} for user {$userId} (page reload detected)\n";

            // Remove from channels
            foreach ($this->channels as $channelId => $members) {
                $filtered = array_filter($members, fn($rid) => $rid !== $resourceId);
                if (empty($filtered)) {
                    unset($this->channels[$channelId]);
                } else {
                    $this->channels[$channelId] = array_values($filtered);
                }
            }

            // Remove from DM channels
            foreach ($this->dmChannels as $dmId => $members) {
                $filtered = array_filter($members, fn($rid) => $rid !== $resourceId);
                if (empty($filtered)) {
                    unset($this->dmChannels[$dmId]);
                } else {
                    $this->dmChannels[$dmId] = array_values($filtered);
                }
            }

            // Remove from voice rooms
            foreach ($this->voiceRooms as $channelId => $members) {
                $key = array_search($resourceId, $members, true);
                if ($key !== false) {
                    unset($this->voiceRooms[$channelId][$key]);
                    $this->voiceRooms[$channelId] = array_values($this->voiceRooms[$channelId]);
                    if (empty($this->voiceRooms[$channelId])) {
                        unset($this->voiceRooms[$channelId]);
                    }
                    // Clean up voice in DB
                    $this->voiceChannelModel->removeMember($userId);
                }
            }

            // Close the stale connection
            if (isset($this->connections[$resourceId])) {
                $staleConn = $this->connections[$resourceId];
                $this->clients->detach($staleConn);
                unset($this->connections[$resourceId]);
                // Close the old socket (will NOT trigger onClose again since we already detached)
                try {
                    $staleConn->close();
                } catch (\Exception $e) {
                    // Connection may already be closing
                }
            }

            unset($this->users[$resourceId]);
        }
    }

    /**
     * Log memory usage for debugging.
     */
    public function logMemoryUsage(): void
    {
        $memMB = round(memory_get_usage(true) / 1024 / 1024, 2);
        $peakMB = round(memory_get_peak_usage(true) / 1024 / 1024, 2);
        $memUsed = round(memory_get_usage(false) / 1024 / 1024, 2);
        $clients = $this->clients->count();
        $users = count($this->users);
        $channels = count($this->channels);
        $voiceRooms = count($this->voiceRooms);
        $connections = count($this->connections);
        echo "[Memory] Alloc: {$memMB}MB | Used: {$memUsed}MB | Peak: {$peakMB}MB | Clients: {$clients} | Connections: {$connections} | Users: {$users} | Channels: {$channels} | VoiceRooms: {$voiceRooms}\n";
    }
}
