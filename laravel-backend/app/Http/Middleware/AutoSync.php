<?php

namespace App\Http\Middleware;

use App\Services\SyncService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * After any data-changing API request finishes (response already sent),
 * push the change to the central server if we're online. Cheap when
 * nothing changed (content-hash skip) and rate-limited while offline.
 */
class AutoSync
{
    public function handle(Request $request, Closure $next): Response
    {
        return $next($request);
    }

    public function terminate(Request $request, Response $response): void
    {
        if (!SyncService::isConfigured()) return;
        if (!in_array($request->method(), ['POST', 'PUT', 'PATCH', 'DELETE'], true)) return;
        if (str_starts_with($request->path(), 'api/sync')) return;
        if ($response->getStatusCode() >= 400) return;
        try {
            app(SyncService::class)->pushSoon();
        } catch (\Throwable $err) {
            // Sync must never break the POS.
        }
    }
}
