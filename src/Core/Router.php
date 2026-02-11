<?php

declare(strict_types=1);

namespace App\Core;

class Router
{
    private array $routes = [];
    private array $middleware = [];

    public function get(string $path, array $handler): self
    {
        return $this->addRoute('GET', $path, $handler);
    }

    public function post(string $path, array $handler): self
    {
        return $this->addRoute('POST', $path, $handler);
    }

    public function put(string $path, array $handler): self
    {
        return $this->addRoute('PUT', $path, $handler);
    }

    public function delete(string $path, array $handler): self
    {
        return $this->addRoute('DELETE', $path, $handler);
    }

    private function addRoute(string $method, string $path, array $handler): self
    {
        $pattern = $this->pathToPattern($path);
        $this->routes[$method][$pattern] = [
            'handler' => $handler,
            'path' => $path,
        ];
        return $this;
    }

    public function addMiddleware(callable $middleware): self
    {
        $this->middleware[] = $middleware;
        return $this;
    }

    private function pathToPattern(string $path): string
    {
        $pattern = preg_replace('/\{([a-zA-Z_]+)\}/', '(?P<$1>[^/]+)', $path);
        return '#^' . $pattern . '$#';
    }

    public function dispatch(string $method, string $uri): mixed
    {
        $uri = parse_url($uri, PHP_URL_PATH);
        $uri = rtrim($uri, '/') ?: '/';

        if (!isset($this->routes[$method])) {
            return $this->handleNotFound();
        }

        foreach ($this->routes[$method] as $pattern => $route) {
            if (preg_match($pattern, $uri, $matches)) {
                $params = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
                return $this->executeHandler($route['handler'], $params);
            }
        }

        return $this->handleNotFound();
    }

    private function executeHandler(array $handler, array $params): mixed
    {
        [$controllerClass, $method] = $handler;

        if (!class_exists($controllerClass)) {
            throw new \RuntimeException("Controller {$controllerClass} not found");
        }

        $container = Container::getInstance();
        $controller = $container->resolve($controllerClass);

        if (!method_exists($controller, $method)) {
            throw new \RuntimeException("Method {$method} not found in {$controllerClass}");
        }

        // Execute middleware
        $request = new Request();
        $request->setParams($params);
        
        foreach ($this->middleware as $middleware) {
            $result = $middleware($request);
            if ($result !== null) {
                return $result;
            }
        }

        return $controller->$method($request);
    }

    private function handleNotFound(): never
    {
        http_response_code(404);
        echo json_encode(['error' => 'Not Found']);
        exit;
    }
}
