#!/usr/bin/env php
<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

error_reporting(E_ALL & ~E_DEPRECATED);

use Dotenv\Dotenv;
use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;
use App\WebSocket\ChatServer;

// Load environment variables
$dotenv = Dotenv::createImmutable(__DIR__ . '/..');
$dotenv->load();

$host = $_ENV['WS_HOST'] ?? '0.0.0.0';
$port = (int)($_ENV['WS_PORT'] ?? 8081);

echo "=================================\n";
echo "  Resonance WebSocket Server\n";
echo "=================================\n";
echo "Starting server on {$host}:{$port}\n";

$chatServer = new ChatServer();

$server = IoServer::factory(
    new HttpServer(
        new WsServer(
            $chatServer
        )
    ),
    $port,
    $host
);

// Periodic memory cleanup and logging every 60 seconds
$server->loop->addPeriodicTimer(60, function () use ($chatServer) {
    gc_collect_cycles();
    $chatServer->logMemoryUsage();
});

echo "Server running. Press Ctrl+C to stop.\n";
echo "=================================\n\n";

$server->run();
