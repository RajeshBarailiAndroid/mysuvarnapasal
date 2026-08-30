<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Services\Store;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Shop moderation, for the single admin account.
 *
 * Every route here sits behind the `admin` middleware, so each method may
 * assume the caller is the admin. The response shapes are dictated by the
 * Android app, which was written first: see data/ApiModels.kt — Account,
 * AdminUsersResponse, AdminCounts, AdminUserResponse, DeleteAccountResponse.
 * Renaming a key here silently breaks the mobile admin screen.
 */
class AdminController extends ApiController
{
    private const STATUSES = [
        User::STATUS_PENDING,
        User::STATUS_APPROVED,
        User::STATUS_DENIED,
        User::STATUS_DEACTIVATED,
    ];

    /** GET /api/admin/users?status=pending&q=ram */
    public function index(Request $request)
    {
        $status = (string) $request->query('status', '');
        $q = trim((string) $request->query('q', ''));

        $query = User::query()->where('is_admin', false);

        if (in_array($status, self::STATUSES, true)) {
            $query->where('status', $status);
        }

        if ($q !== '') {
            $like = '%' . $q . '%';
            $query->where(function ($w) use ($like) {
                $w->where('username', 'like', $like)
                  ->orWhere('name', 'like', $like)
                  ->orWhere('email', 'like', $like)
                  ->orWhere('phone', 'like', $like);
            });
        }

        // Pending first — the queue is the reason this screen exists.
        $users = $query
            ->orderByRaw("CASE WHEN status = 'pending' THEN 0 ELSE 1 END")
            ->orderByDesc('created_at')
            ->limit(500)
            ->get();

        $counts = User::query()
            ->where('is_admin', false)
            ->groupBy('status')
            ->select('status', DB::raw('count(*) as total'))
            ->pluck('total', 'status');

        return response()->json([
            'users' => $users->map(fn (User $u) => $u->toAccountArray())->values(),
            'counts' => [
                'pending' => (int) ($counts[User::STATUS_PENDING] ?? 0),
                'approved' => (int) ($counts[User::STATUS_APPROVED] ?? 0),
                'denied' => (int) ($counts[User::STATUS_DENIED] ?? 0),
                'deactivated' => (int) ($counts[User::STATUS_DEACTIVATED] ?? 0),
            ],
            'subscriptionYears' => User::SUBSCRIPTION_YEARS,
        ]);
    }

    /**
     * POST /api/admin/users/{id}/approve
     *
     * Approving from pending or denied starts a fresh subscription. Re-approving
     * an already-approved shop is treated as a renewal rather than a no-op, so
     * the admin cannot accidentally shorten someone's term by double-tapping.
     */
    public function approve(Request $request, string $id)
    {
        return $this->transition($request, $id, function (User $user) use ($request) {
            $wasApproved = $user->isApproved() && !$user->isExpired();

            $user->status = User::STATUS_APPROVED;
            $user->read_only = false;
            $user->approved_at = now();
            $user->approved_by = (string) ($this->actor($request)->username ?? 'admin');
            $user->status_reason = null;

            if (!$wasApproved) {
                $user->expires_at = now()->addYears(User::SUBSCRIPTION_YEARS);
            }
            return 'approve';
        });
    }

    /**
     * POST /api/admin/users/{id}/extend — add another subscription year.
     * Extends from the current expiry when it is still in the future, so
     * renewing early does not cost the shop the time it already paid for.
     */
    public function extend(Request $request, string $id)
    {
        return $this->transition($request, $id, function (User $user) {
            $base = ($user->expires_at && $user->expires_at->isFuture())
                ? $user->expires_at
                : now();
            $user->expires_at = $base->copy()->addYears(User::SUBSCRIPTION_YEARS);
            return 'extend';
        }, revokeTokens: false);
    }

    /** POST /api/admin/users/{id}/unapprove — back to pending. */
    public function unapprove(Request $request, string $id)
    {
        return $this->transition($request, $id, function (User $user) use ($request) {
            $user->status = User::STATUS_PENDING;
            $user->status_reason = $this->reason($request);
            return 'unapprove';
        });
    }

    /** POST /api/admin/users/{id}/deny */
    public function deny(Request $request, string $id)
    {
        return $this->transition($request, $id, function (User $user) use ($request) {
            $user->status = User::STATUS_DENIED;
            $user->status_reason = $this->reason($request);
            return 'deny';
        });
    }

    /**
     * POST /api/admin/users/{id}/deactivate
     *
     * Deliberately softer than deny: the shop keeps its session and can still
     * read its own data, but every write is refused. Used when a shop is
     * behind on payment and you want them to be able to export their records.
     */
    public function deactivate(Request $request, string $id)
    {
        return $this->transition($request, $id, function (User $user) use ($request) {
            $user->status = User::STATUS_DEACTIVATED;
            $user->read_only = true;
            $user->status_reason = $this->reason($request);
            return 'deactivate';
        }, revokeTokens: false);
    }

    /** POST /api/admin/users/{id}/reactivate */
    public function reactivate(Request $request, string $id)
    {
        return $this->transition($request, $id, function (User $user) use ($request) {
            $user->status = User::STATUS_APPROVED;
            $user->read_only = false;
            $user->status_reason = null;
            if ($user->expires_at === null || $user->expires_at->isPast()) {
                $user->expires_at = now()->addYears(User::SUBSCRIPTION_YEARS);
            }
            $user->approved_by = (string) ($this->actor($request)->username ?? 'admin');
            return 'reactivate';
        }, revokeTokens: false);
    }

    /**
     * DELETE /api/admin/users/{id}?confirmUsername=someshop
     *
     * Irreversible: the account AND every row of that shop's POS data are
     * removed. The username must be typed back to confirm, which is why the
     * mobile app sends `confirmUsername` — a mis-tap on a list row must not be
     * able to destroy a shop's records.
     */
    public function destroy(Request $request, string $id)
    {
        $user = User::find($id);
        if (!$user) return $this->fail('Account not found.', 404);
        if ($user->is_admin) return $this->fail('The administrator account cannot be deleted.', 422);

        $confirm = trim((string) $request->query('confirmUsername', ''));
        if ($confirm === '' || strtolower($confirm) !== strtolower((string) $user->username)) {
            return $this->fail('Type the username exactly to confirm deletion.', 422);
        }

        $username = (string) $user->username;

        DB::transaction(function () use ($user) {
            $user->tokens()->delete();
            $this->store->purgeUser((string) $user->id);
            $user->delete();
        });

        Log::warning('admin.account_deleted', [
            'actor' => $this->actor($request)->username ?? 'admin',
            'deleted' => $username,
            'ip' => $request->ip(),
        ]);

        return response()->json(['ok' => true, 'deleted' => $username]);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /**
     * Shared plumbing for every state change: load, guard, mutate, and
     * (where the change removes access) revoke the shop's tokens so they are
     * signed out on their very next request rather than whenever their token
     * happens to expire.
     */
    private function transition(Request $request, string $id, callable $mutate, bool $revokeTokens = true)
    {
        $user = User::find($id);
        if (!$user) return $this->fail('Account not found.', 404);
        if ($user->is_admin) return $this->fail('The administrator account cannot be moderated.', 422);

        $action = null;
        DB::transaction(function () use ($user, $mutate, $revokeTokens, &$action) {
            $action = $mutate($user);
            $user->status_changed_at = now();
            $user->save();

            if ($revokeTokens) {
                $user->tokens()->delete();
            }
        });

        Log::info('admin.account_' . $action, [
            'actor' => $this->actor($request)->username ?? 'admin',
            'target' => $user->username,
            'status' => $user->status,
            'ip' => $request->ip(),
        ]);

        return response()->json([
            'ok' => true,
            'user' => $user->fresh()->toAccountArray(),
        ]);
    }

    private function actor(Request $request): ?User
    {
        $user = $request->attributes->get('authUser');
        return $user instanceof User ? $user : null;
    }

    private function reason(Request $request): ?string
    {
        $body = $request->json()->all();
        $reason = trim((string) ($body['reason'] ?? ''));
        return $reason === '' ? null : mb_substr($reason, 0, 500);
    }
}
