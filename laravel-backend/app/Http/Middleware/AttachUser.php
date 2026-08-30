<?php

namespace App\Http\Middleware;

use App\Services\Store;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * Attaches the acting user id to the request (like middlewares/auth.ts).
 *
 * - AUTH_ENABLED=true  -> require a valid Sanctum bearer token.
 * - AUTH_ENABLED=false -> single-shop mode: everything runs as 'local-dev'.
 */
class AttachUser
{
    public static function authEnabled(): bool
    {
        return filter_var(env('AUTH_ENABLED', true), FILTER_VALIDATE_BOOLEAN);
    }

    public static function resolveToken(Request $request): ?PersonalAccessToken
    {
        $header = (string) $request->header('Authorization', '');
        $token = str_starts_with($header, 'Bearer ') ? substr($header, 7) : '';
        if ($token === '') return null;
        $accessToken = PersonalAccessToken::findToken($token);
        if (!$accessToken || !$accessToken->tokenable) return null;
        return $accessToken;
    }

    public function handle(Request $request, Closure $next): Response
    {
        if (!self::authEnabled()) {
            $request->attributes->set('userId', Store::LOCAL_DEV_USER_ID);
            return $next($request);
        }
        $accessToken = self::resolveToken($request);
        if (!$accessToken) {
            return response()->json(['error' => 'Sign in required.'], 401);
        }

        $user = $accessToken->tokenable;

        // Re-check approval on EVERY request, not just at login. A token minted
        // while the shop was approved must stop working the moment the admin
        // suspends them — otherwise a suspended shop keeps trading until their
        // token happens to expire.
        //
        // Deactivated accounts are the deliberate exception: they stay signed
        // in and readable, and the `writable` middleware refuses their writes.
        if ($user && !$user->canUseApi() && $user->status !== \App\Models\User::STATUS_DEACTIVATED) {
            return response()->json([
                'error' => $user->accessMessage(),
                'status' => $user->status,
                'expired' => $user->isExpired(),
            ], 403);
        }

        $request->attributes->set('userId', (string) $accessToken->tokenable_id);
        $request->attributes->set('authUser', $user);
        $request->attributes->set('accessToken', $accessToken);
        return $next($request);
    }
}
