<?php

namespace App\Http\Middleware;

use App\Services\Store;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

/**
 * One writer per shop at a time.
 *
 * Every mutating controller does read-whole-store → change → write-whole-
 * store. Two of those overlapping for the same shop (the phone and the
 * web, or a double-tapped Sell button) both read quantity 1, both pass the
 * stock check, and the second write silently discards the first one's
 * sale. This takes a per-shop lock for the duration of any POST/PUT/PATCH/
 * DELETE so they queue instead. Reads are untouched.
 *
 * Uses the cache store's atomic lock (database driver supports it); waits
 * up to 10 s, which is far longer than any request here takes.
 */
class SerializeShopWrites
{
    public function handle(Request $request, Closure $next): Response
    {
        if (in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
            return $next($request);
        }
        $userId = (string) $request->attributes->get('userId', Store::LOCAL_DEV_USER_ID);
        $lock = Cache::lock('shop-write:' . $userId, 15);
        try {
            return $lock->block(10, fn () => $next($request));
        } catch (\Illuminate\Contracts\Cache\LockTimeoutException $e) {
            return response()->json(['error' => 'The shop is busy saving another change. Please try again.'], 409);
        }
    }
}
