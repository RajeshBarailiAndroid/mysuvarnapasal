<?php

namespace App\Http\Controllers\Api;

use App\Services\SharedRates;
use App\Services\SyncService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Two roles in one controller:
 *
 * SERVER role (the hosted Laravel + MySQL install):
 *   POST /api/sync/push  — receive a shop's data (token-authenticated)
 *   GET  /api/sync/pull  — hand a shop back its data (restore)
 *
 * SHOP role (the desktop install):
 *   GET  /api/sync/run     — run a sync pass now (Electron pings this)
 *   GET  /api/sync/status  — last sync time / last error, for the UI
 */
class SyncController extends ApiController
{
    private function authorized(Request $request): bool
    {
        $token = SyncService::token();
        if ($token === '') return false;
        $header = (string) $request->header('Authorization', '');
        $given = str_starts_with($header, 'Bearer ') ? substr($header, 7) : '';
        return $given !== '' && hash_equals($token, $given);
    }

    public function push(Request $request)
    {
        if (!$this->authorized($request)) return $this->fail('Sync token invalid.', 401);
        $body = $request->json()->all();
        $kind = $body['kind'] ?? 'store';

        if ($kind === 'store') {
            $userId = (string) ($body['userId'] ?? '');
            $store = $body['store'] ?? null;
            if ($userId === '' || !is_array($store)) return $this->fail('userId and store are required.');
            $this->store->write($userId, $store);
            return response()->json(['ok' => true, 'kind' => 'store', 'userId' => $userId]);
        }

        if ($kind === 'shared_rates') {
            $shared = $body['sharedRates'] ?? null;
            if (!is_array($shared)) return $this->fail('sharedRates is required.');
            SharedRates::write($shared);
            return response()->json(['ok' => true, 'kind' => 'shared_rates']);
        }

        if ($kind === 'users') {
            $users = is_array($body['users'] ?? null) ? $body['users'] : [];
            foreach ($users as $u) {
                if (!is_array($u) || !isset($u['id'])) continue;
                // SECURITY: 'password' and 'remember_token' are deliberately NOT
                // accepted. Allowing them makes this endpoint a password-hash
                // overwrite primitive for anyone holding the sync token, which
                // is account takeover for every shop on this server.
                // Credentials do not replicate.
                // SECURITY: 'email' and 'username' are not accepted either.
                // Changing an account's email through sync would redirect
                // its password-reset mail, and changing the username lets
                // one account impersonate another at login. Neither is
                // something a desktop backup should be able to do.
                // Administrator rows, and any row carrying an admin/status
                // flag, are never touched from here.
                $row = array_intersect_key($u, array_flip([
                    'id', 'name', 'phone', 'email_verified_at', 'created_at', 'updated_at',
                ]));
                $existing = DB::table('users')->where('id', $row['id'])->first();
                if ($existing && $existing->is_admin) continue;
                if (!$existing) continue;   // accounts are created by signup, never by sync
                DB::table('users')->where('id', $row['id'])->update($row);
            }
            return response()->json(['ok' => true, 'kind' => 'users', 'count' => count($users)]);
        }

        return $this->fail('Unknown sync kind.');
    }

    public function pull(Request $request)
    {
        if (!$this->authorized($request)) return $this->fail('Sync token invalid.', 401);
        $userId = (string) $request->query('userId', '');
        if ($userId === '') return $this->fail('userId is required.');
        return response()->json([
            'ok' => true,
            'userId' => $userId,
            'store' => $this->store->read($userId),
            'sharedRates' => SharedRates::read(),
        ]);
    }

    /**
     * Desktop → server replication. On the shared server itself only the
     * administrator may trigger or inspect it: a shop must not be able to
     * kick off a push of every account, nor read the sync server's host and
     * last error.
     */
    private function desktopOrAdmin(Request $request): bool
    {
        if (!\App\Http\Middleware\AttachUser::authEnabled()) return true;   // single-shop desktop
        $user = $request->attributes->get('authUser');
        return $user && $user->is_admin;
    }

    public function run(Request $request, SyncService $sync)
    {
        if (!$this->desktopOrAdmin($request)) return $this->fail('Not found.', 404);
        return response()->json($sync->run());
    }

    public function status(Request $request, SyncService $sync)
    {
        if (!$this->desktopOrAdmin($request)) return $this->fail('Not found.', 404);
        return response()->json($sync->status());
    }

    public function restore(Request $request, SyncService $sync)
    {
        // Local restore trigger: pull this user's data down from the server.
        // SECURITY: token-gated — this OVERWRITES the local store with server
        // data, so an unauthenticated caller could otherwise wipe a shop's
        // book or pull a different shop's data into it.
        if (!$this->authorized($request)) return $this->fail('Sync token invalid.', 401);
        $userId = (string) ($request->json()->all()['userId'] ?? $request->query('userId', ''));
        if ($userId === '') return $this->fail('userId is required.');
        return response()->json($sync->pull($userId));
    }
}
