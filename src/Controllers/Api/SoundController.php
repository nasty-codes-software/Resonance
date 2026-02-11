<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Core\Request;
use App\Core\Session;
use App\Core\Database;
use App\Models\Sound;

class SoundController extends BaseController
{
    private Sound $soundModel;

    public function __construct(Database $db)
    {
        parent::__construct($db);
        $this->soundModel = new Sound($db);
    }

    public function list(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
        }

        $sounds = $this->soundModel->getAllSounds();
        $this->json(['sounds' => $sounds]);
    }

    public function upload(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
        }

        $file = $request->file('sound');
        $name = trim($request->post('name', ''));

        if (!$file || $file['error'] !== UPLOAD_ERR_OK) {
            $this->json(['error' => 'No file uploaded or upload error'], 400);
        }

        if (empty($name)) {
            // Use filename without extension as name
            $name = pathinfo($file['name'], PATHINFO_FILENAME);
        }

        if (strlen($name) > 100) {
            $this->json(['error' => 'Sound name is too long'], 400);
        }

        $result = $this->soundModel->uploadSound($file, $name, Session::getUserId());

        if (isset($result['error'])) {
            $this->json(['error' => $result['error']], 400);
        }

        $sound = $this->soundModel->find($result['id']);

        $this->json([
            'success' => true,
            'sound' => $sound
        ]);
    }

    public function delete(Request $request, string $id): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
        }

        $sound = $this->soundModel->find((int)$id);

        if (!$sound) {
            $this->json(['error' => 'Sound not found'], 404);
        }

        // Only admin or uploader can delete
        if (!Session::isAdmin() && $sound['uploaded_by'] !== Session::getUserId()) {
            $this->json(['error' => 'Permission denied'], 403);
        }

        $this->soundModel->deleteSound((int)$id);

        $this->json(['success' => true]);
    }

    public function play(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            http_response_code(401);
            exit;
        }

        $id = $request->param('id');
        $filepath = $this->soundModel->getFilePath((int)$id);

        if (!$filepath) {
            http_response_code(404);
            exit;
        }

        $sound = $this->soundModel->find((int)$id);
        $mimeType = mime_content_type($filepath);

        header('Content-Type: ' . $mimeType);
        header('Content-Length: ' . filesize($filepath));
        header('Content-Disposition: inline; filename="' . $sound['original_name'] . '"');
        header('Accept-Ranges: bytes');
        header('Cache-Control: public, max-age=31536000');

        readfile($filepath);
        exit;
    }
}
