<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Core\Request;
use App\Core\Session;
use App\Core\Database;
use App\Models\TextChannel;
use App\Models\Message;

class ChannelController extends BaseController
{
    private TextChannel $textChannelModel;
    private Message $messageModel;

    public function __construct(Database $db)
    {
        parent::__construct($db);
        $this->textChannelModel = new TextChannel($db);
        $this->messageModel = new Message($db);
    }

    public function list(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
        }

        $channels = $this->textChannelModel->getAllOrdered();
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
        $description = trim($data['description'] ?? '');
        $categoryId = isset($data['category_id']) ? (int)$data['category_id'] : null;

        if (empty($name)) {
            $this->json(['error' => 'Channel name is required'], 400);
            return;
        }

        if (strlen($name) > 100) {
            $this->json(['error' => 'Channel name is too long'], 400);
            return;
        }

        // Sanitize channel name (lowercase, no spaces)
        $name = strtolower(preg_replace('/[^a-zA-Z0-9-]/', '-', $name));

        // Check if channel exists
        if ($this->textChannelModel->findByName($name)) {
            $this->json(['error' => 'Channel already exists'], 400);
            return;
        }

        $channelId = $this->textChannelModel->createChannel(
            $name,
            Session::getUserId(),
            $description ?: null,
            $categoryId
        );

        $channel = $this->textChannelModel->find($channelId);

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
        $channel = $this->textChannelModel->find($id);

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
        $channel = $this->textChannelModel->find($id);

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
            $name = strtolower(preg_replace('/[^a-zA-Z0-9-]/', '-', trim($data['name'])));
            if (!empty($name) && $name !== $channel['name']) {
                $existing = $this->textChannelModel->findByName($name);
                if ($existing && $existing['id'] !== $id) {
                    $this->json(['error' => 'Channel name already exists'], 400);
                    return;
                }
                $updateData['name'] = $name;
            }
        }

        if (isset($data['description'])) {
            $updateData['description'] = trim($data['description']);
        }

        if (isset($data['category_id'])) {
            $updateData['category_id'] = $data['category_id'] ? (int)$data['category_id'] : null;
        }

        if (!empty($updateData)) {
            $this->textChannelModel->update($id, $updateData);
        }

        $this->json(['success' => true, 'channel' => $this->textChannelModel->find($id)]);
    }

    public function delete(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $channel = $this->textChannelModel->find($id);

        if (!$channel) {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        // Only admin or channel creator can delete
        if (!Session::isAdmin() && $channel['created_by'] !== Session::getUserId()) {
            $this->json(['error' => 'Permission denied'], 403);
            return;
        }

        // Delete messages first
        $this->messageModel->deleteChannelMessages($id);
        $this->textChannelModel->delete($id);

        $this->json(['success' => true]);
    }

    public function getMessages(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $channel = $this->textChannelModel->find($id);

        if (!$channel) {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        $limit = min((int)($request->query('limit') ?? 50), 100);
        $offset = (int)($request->query('offset') ?? 0);

        $messages = $this->messageModel->getChannelMessages($id, $limit, $offset);

        $this->json([
            'channel' => $channel,
            'messages' => array_reverse($messages)
        ]);
    }

    public function getPinnedMessages(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $channel = $this->textChannelModel->find($id);

        if (!$channel) {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        $messages = $this->messageModel->getPinnedMessages($id);

        $this->json([
            'messages' => $messages
        ]);
    }

    public function searchMessages(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $query = trim($request->query('q') ?? '');

        if (strlen($query) < 2) {
            $this->json(['error' => 'Query too short'], 400);
            return;
        }

        $channel = $this->textChannelModel->find($id);

        if (!$channel) {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        $messages = $this->messageModel->searchMessages($id, $query, 20);

        $this->json([
            'messages' => $messages,
            'channel' => $channel
        ]);
    }

    public function searchAllChannels(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $query = trim($request->query('q') ?? '');

        if (strlen($query) < 2) {
            $this->json(['error' => 'Query too short'], 400);
            return;
        }

        $messages = $this->messageModel->searchAllMessages($query, 30);

        $this->json([
            'messages' => $messages
        ]);
    }

    public function uploadAttachment(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $channel = $this->textChannelModel->find($id);

        if (!$channel) {
            $this->json(['error' => 'Channel not found'], 404);
            return;
        }

        $file = $request->file('file');
        $messageText = trim($request->post('message', ''));

        if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
            $this->json(['error' => 'No file uploaded or upload error'], 400);
            return;
        }

        // Validate file size (max 10MB)
        $maxSize = 10 * 1024 * 1024;
        if ($file['size'] > $maxSize) {
            $this->json(['error' => 'File too large. Maximum size is 10MB'], 400);
            return;
        }

        // Allowed file types
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

        // Determine attachment type
        $isImage = str_starts_with($mimeType, 'image/');
        $attachmentType = $isImage ? 'image' : 'file';

        // Generate unique filename
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

        // Create URL for the attachment
        $attachmentUrl = '/storage/attachments/' . $filename;
        $originalName = $file['name'];

        // Create message with attachment
        $content = $messageText ?: '';
        $messageId = $this->messageModel->createMessage(
            $id,
            Session::getUserId(),
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
}
