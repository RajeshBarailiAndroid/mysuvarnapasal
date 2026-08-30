<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Refuses writes from a shop the admin has put in read-only mode, while
 * leaving reads alone so they can still see and export their own records.
 *
 * Only unsafe methods are blocked; GET and HEAD pass through untouched.
 */
class EnsureWritable
{
    public function handle(Request $request, Closure $next): Response
    {
        if (in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
            return $next($request);
        }

        $user = $request->attributes->get('authUser');

        if ($user instanceof User && $user->read_only && !$user->is_admin) {
            return response()->json([
                'error' => 'This account is read-only. Contact the administrator.',
                'readOnly' => true,
            ], 403);
        }

        return $next($request);
    }
}
