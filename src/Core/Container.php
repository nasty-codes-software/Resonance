<?php

declare(strict_types=1);

namespace App\Core;

use ReflectionClass;
use ReflectionParameter;

class Container
{
    private static ?Container $instance = null;
    private array $bindings = [];
    private array $instances = [];

    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function bind(string $abstract, callable|string $concrete): void
    {
        $this->bindings[$abstract] = $concrete;
    }

    public function singleton(string $abstract, callable|string $concrete): void
    {
        $this->bind($abstract, function () use ($abstract, $concrete) {
            if (!isset($this->instances[$abstract])) {
                $this->instances[$abstract] = is_callable($concrete) 
                    ? $concrete($this) 
                    : $this->resolve($concrete);
            }
            return $this->instances[$abstract];
        });
    }

    public function instance(string $abstract, object $instance): void
    {
        $this->instances[$abstract] = $instance;
    }

    public function resolve(string $abstract): object
    {
        // Check if we have a singleton instance
        if (isset($this->instances[$abstract])) {
            return $this->instances[$abstract];
        }

        // Check if we have a binding
        if (isset($this->bindings[$abstract])) {
            $concrete = $this->bindings[$abstract];
            if (is_callable($concrete)) {
                return $concrete($this);
            }
            return $this->resolve($concrete);
        }

        // Auto-resolve using reflection
        return $this->build($abstract);
    }

    private function build(string $class): object
    {
        if (!class_exists($class)) {
            throw new \RuntimeException("Class {$class} does not exist");
        }

        $reflection = new ReflectionClass($class);

        if (!$reflection->isInstantiable()) {
            throw new \RuntimeException("Class {$class} is not instantiable");
        }

        $constructor = $reflection->getConstructor();

        if ($constructor === null) {
            return new $class();
        }

        $parameters = $constructor->getParameters();
        $dependencies = $this->resolveDependencies($parameters);

        return $reflection->newInstanceArgs($dependencies);
    }

    private function resolveDependencies(array $parameters): array
    {
        $dependencies = [];

        foreach ($parameters as $parameter) {
            $type = $parameter->getType();

            if ($type === null || $type->isBuiltin()) {
                if ($parameter->isDefaultValueAvailable()) {
                    $dependencies[] = $parameter->getDefaultValue();
                } else {
                    throw new \RuntimeException(
                        "Cannot resolve parameter {$parameter->getName()}"
                    );
                }
                continue;
            }

            $dependencies[] = $this->resolve($type->getName());
        }

        return $dependencies;
    }
}
