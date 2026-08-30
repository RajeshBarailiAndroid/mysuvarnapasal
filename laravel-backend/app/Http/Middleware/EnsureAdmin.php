<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate for /api/admin/*. Runs after AttachUser, so a token is already resolved.
 *
 * Returns 404 rather than 403 to non-admins: a 403 confirms the admin API
 * exists and is worth attacking, while a 404 is indistinguishable from a
 * typo'd URL.
 *
 * Note this does NOT honour AUTH_ENABLED=false. No-login mode exists so the
 * desktop app can run single-shop without a server account; it must never
 * hand out moderation powers over every shop.
 */
class EnsureAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->attributes->get('authUser');

        if (!$user instanceof User || !$user->is_admin) {
            return response()->json(['error' => 'Not found.'], 404);
        }

        if ($user->must_change_password) {
            // 409, deliberately NOT 403. The Android admin screen reads any 403
            // as "this account is no longer an admin" and navigates away, which
            // would bounce a freshly bootstrapped admin out of the tab without
            // ever showing them why. 409 keeps them on the screen with the
            // message visible: Settings -> Change password.
            return response()->json([
                'error' => 'Change your password first: open Settings -> Change password, then come back.',
                'mustChangePassword' => true,
            ], 409);
        }

        return $next($request);
    }
}
