<?php

use App\Http\Middleware\AttachUser;
use App\Http\Middleware\AutoSync;
use App\Http\Middleware\EnsureAdmin;
use App\Http\Middleware\EnsureWritable;
use App\Http\Middleware\SerializeShopWrites;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'attach.user' => AttachUser::class,
            'admin' => EnsureAdmin::class,
            'writable' => EnsureWritable::class,
            'shop.lock' => SerializeShopWrites::class,
        ]);
        $middleware->appendToGroup('api', AutoSync::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();

if ($storagePath = $_SERVER['LARAVEL_STORAGE_PATH'] ?? $_ENV['LARAVEL_STORAGE_PATH'] ?? null) {
    $app->useStoragePath($storagePath);
}

return $app;

