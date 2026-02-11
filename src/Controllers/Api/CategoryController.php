<?php

declare(strict_types=1);

namespace App\Controllers\Api;

use App\Controllers\BaseController;
use App\Core\Request;
use App\Core\Session;
use App\Core\Database;
use App\Models\Category;

class CategoryController extends BaseController
{
    private Category $categoryModel;

    public function __construct(Database $db)
    {
        parent::__construct($db);
        $this->categoryModel = new Category($db);
    }

    public function list(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $categories = $this->categoryModel->getAllWithChannels();
        $this->json(['categories' => $categories]);
    }

    public function get(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $category = $this->categoryModel->find($id);

        if (!$category) {
            $this->json(['error' => 'Category not found'], 404);
            return;
        }

        $this->json(['category' => $category]);
    }

    public function create(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $data = $request->json();
        $name = trim($data['name'] ?? '');

        if (empty($name)) {
            $this->json(['error' => 'Category name is required'], 400);
            return;
        }

        $userId = Session::getUserId();
        $categoryId = $this->categoryModel->createCategory($name, $userId);

        $category = $this->categoryModel->find($categoryId);
        $this->json(['success' => true, 'category' => $category], 201);
    }

    public function update(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $data = $request->json();
        $name = trim($data['name'] ?? '');

        if (empty($name)) {
            $this->json(['error' => 'Category name is required'], 400);
            return;
        }

        $this->categoryModel->update($id, ['name' => $name]);
        $this->json(['success' => true]);
    }

    public function delete(Request $request): void
    {
        if (!Session::isAuthenticated()) {
            $this->json(['error' => 'Unauthorized'], 401);
            return;
        }

        $id = (int)$request->param('id');
        $this->categoryModel->delete($id);
        $this->json(['success' => true]);
    }
}
