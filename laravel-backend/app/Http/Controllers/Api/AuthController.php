<?php

namespace App\Http\Controllers\Api;

use App\Http\Middleware\AttachUser;
use App\Models\User;
use App\Support\Pos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Username/password auth using Laravel Sanctum personal access tokens.
 * Endpoint paths and response shapes mirror the original Express auth
 * router so the frontend needs minimal changes.
 *
 * Two rules run through this file:
 *   1. New shops can only be created from the mobile app, and land `pending`
 *      until the administrator approves them.
 *   2. Nothing here ever tells an anonymous caller whether an account exists.
 */
class AuthController extends ApiController
{
    /** Minutes a password-reset link stays usable. */
    private const RESET_TTL_MINUTES = 60;

    public function config()
    {
        return response()->json([
            'enabled' => AttachUser::authEnabled(),
            'driver' => 'sanctum',
            // The web sign-in page reads this to keep its "create an account"
            // affordance hidden rather than hard-coding the rule twice.
            'signupPlatforms' => ['mobile'],
        ]);
    }

    private static function normalizeUsername($value): string
    {
        return preg_replace('/\s+/', '', strtolower(trim((string) ($value ?? ''))));
    }

    private static function isValidUsername(string $username): bool
    {
        return (bool) preg_match('/^[a-z0-9_]{3,24}$/', $username);
    }

    private static function isValidEmail(string $email): bool
    {
        return (bool) preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email);
    }

    /**
     * Length check for a password being *presented* (login, current password).
     * Kept at 6 so shops created before the rule tightened can still sign in.
     */
    private static function isValidPassword(string $password): bool
    {
        $len = strlen($password);
        return $len >= 6 && $len <= 128;
    }

    /**
     * Stricter rule for a password being *set*. Matches validateNewPassword()
     * in the web frontend's auth-page-common.js — 8 characters minimum.
     */
    private static function newPasswordError(string $password, ?string $confirm = null, array $context = []): ?string
    {
        $len = strlen($password);
        if ($len < 8 || $len > 128) return 'New password must be at least 8 characters.';
        if ($confirm !== null && $password !== $confirm) return 'Passwords do not match.';

        $lower = strtolower($password);
        foreach ($context as $needle) {
            $needle = strtolower(trim((string) $needle));
            // Only meaningful fragments — a 1-2 character username would
            // otherwise reject almost every password the user could type.
            if ($needle !== '' && strlen($needle) >= 4 && str_contains($lower, $needle)) {
                return 'Password must not contain your username or email.';
            }
        }
        if (in_array($lower, ['password', 'password1', '12345678', 'qwertyui', 'subarnapasal'], true)) {
            return 'That password is too easy to guess.';
        }
        return null;
    }

    /** True when the request came from the Android/iOS app. */
    private static function isMobileClient(Request $request): bool
    {
        $client = strtolower(trim((string) $request->header('X-SP-Client', '')));
        return in_array($client, ['mobile', 'android', 'ios'], true);
    }

    private function sessionPayload(User $user, string $token): array
    {
        return [
            'access_token' => $token,
            'token_type' => 'bearer',
            // The mobile app reads `account` straight off the session to decide
            // whether to show the admin tab and the expiry banner.
            'account' => $user->toAccountArray(),
            'user' => [
                'id' => (string) $user->id,
                'email' => $user->email,
                'user_metadata' => [
                    'username' => $user->username,
                    'full_name' => $user->name,
                    'phone' => $user->phone,
                ],
            ],
        ];
    }

    /**
     * POST /auth/signup — MOBILE ONLY.
     *
     * Creates the shop as `pending` and issues no token: approval is the
     * administrator's call, so there is nothing to sign in to yet.
     */
    public function signup(Request $request)
    {
        if (!AttachUser::authEnabled()) return $this->fail('Sign-in is not configured yet.', 503);

        if (!self::isMobileClient($request)) {
            return $this->fail('New shops can only be registered from the SubarnaPasal mobile app.', 403);
        }

        $body = $request->json()->all();
        $username = self::normalizeUsername($body['username'] ?? '');
        $fullName = Pos::str($body['full_name'] ?? '');
        $email = Pos::str($body['email'] ?? '');
        $phone = Pos::str($body['phone'] ?? '');
        $password = (string) ($body['password'] ?? '');
        if (!self::isValidUsername($username)) return $this->fail('Username must be 3–24 characters (letters, numbers, underscore).');
        if ($fullName === '') return $this->fail('Enter your full name.');
        if ($email === '' && $phone === '') return $this->fail('Enter an email address or mobile number.');
        if ($email !== '' && !self::isValidEmail($email)) return $this->fail('Enter a valid email address.');
        if ($phone !== '' && !Pos::isValidPhoneForRegion($phone, $body['phoneRegion'] ?? null)) {
            return $this->fail(Pos::phoneErrorMessage(Pos::normalizePhoneRegion($body['phoneRegion'] ?? null)));
        }
        if ($err = self::newPasswordError($password, null, [$username, explode('@', $email)[0] ?? ''])) {
            return $this->fail($err);
        }
        if (User::where('username', $username)->exists()) return $this->fail('That username is already taken.', 409);

        $user = User::create([
            'name' => $fullName,
            'username' => $username,
            'email' => $email !== '' ? strtolower($email) : null,
            'phone' => $phone !== '' ? $phone : null,
            'password' => $password,
            'status' => User::STATUS_PENDING,
            'status_changed_at' => now(),
        ]);
        $this->store->ensureUserSettings((string) $user->id);

        Log::info('auth.signup_pending', ['username' => $username, 'ip' => $request->ip()]);

        return response()->json([
            'ok' => true,
            'pending' => true,
            'status' => User::STATUS_PENDING,
            'message' => 'Your shop has been registered and is waiting for administrator approval. '
                . 'You will be able to sign in once it is approved.',
        ], 201);
    }

    public function login(Request $request)
    {
        if (!AttachUser::authEnabled()) return $this->fail('Sign-in is not configured yet.', 503);
        $body = $request->json()->all();
        $username = self::normalizeUsername($body['username'] ?? '');
        $password = (string) ($body['password'] ?? '');
        if (!self::isValidUsername($username) || !self::isValidPassword($password)) {
            return $this->fail('Incorrect username or password.', 400);
        }
        $user = User::where('username', $username)->first();
        if (!$user || !Hash::check($password, $user->password)) {
            return $this->fail('Incorrect username or password.', 401);
        }

        // Credentials were correct; the account itself may still be barred.
        // This is checked AFTER the password so the message cannot be used to
        // enumerate which usernames are pending approval.
        if (!$user->canUseApi()) {
            return response()->json([
                'error' => $user->accessMessage(),
                'status' => $user->status,
                'expired' => $user->isExpired(),
            ], 403);
        }

        $this->store->ensureUserSettings((string) $user->id);
        $token = $user->createToken('subarnapasal')->plainTextToken;
        return response()->json(['ok' => true, 'session' => $this->sessionPayload($user, $token)]);
    }

    public function me(Request $request)
    {
        if (!AttachUser::authEnabled()) return $this->fail('Sign-in is not configured yet.', 503);
        $accessToken = AttachUser::resolveToken($request);
        if (!$accessToken) return $this->fail('Authorization required.', 401);
        $user = $accessToken->tokenable;
        return response()->json([
            'ok' => true,
            'displayName' => $user->name,
            'username' => $user->username,
            'status' => $user->status,
            'isAdmin' => (bool) $user->is_admin,
            'expiresAt' => optional($user->expires_at)->toIso8601String(),
            'remainingDays' => $user->remainingDays(),
            'readOnly' => (bool) $user->read_only,
            'mustChangePassword' => (bool) $user->must_change_password,
        ]);
    }

    public function logout(Request $request)
    {
        $accessToken = AttachUser::resolveToken($request);
        if ($accessToken) $accessToken->delete();
        return response()->json(['ok' => true]);
    }

    public function changePassword(Request $request)
    {
        if (!AttachUser::authEnabled()) return $this->fail('Sign-in is not configured yet.', 503);
        $accessToken = AttachUser::resolveToken($request);
        if (!$accessToken) return $this->fail('Authorization required.', 401);
        $user = $accessToken->tokenable;
        $body = $request->json()->all();
        $currentPassword = (string) ($body['currentPassword'] ?? '');
        $password = (string) ($body['password'] ?? '');
        $confirm = (string) ($body['confirm'] ?? '');
        if (!self::isValidPassword($currentPassword)) return $this->fail('Enter your current password.');
        if ($err = self::newPasswordError($password, $confirm, [$user->username, explode('@', (string) $user->email)[0] ?? ''])) {
            return $this->fail($err);
        }
        if ($password === $currentPassword) return $this->fail('Choose a different password.');
        if (!Hash::check($currentPassword, $user->password)) return $this->fail('Current password is incorrect.', 401);

        $user->password = $password;
        $user->must_change_password = false;
        $user->save();
        // Sign out everywhere (like the Express global sign-out).
        $user->tokens()->delete();
        return response()->json(['ok' => true, 'message' => 'Password updated.']);
    }

    /**
     * POST /auth/forgot-password  {username?, email?}
     *
     * Always answers with the same message and a 200, whether or not the
     * account exists — otherwise this endpoint is a free list of which shops
     * are registered. The work is done regardless so the timing matches too.
     */
    public function forgotPassword(Request $request)
    {
        $body = $request->json()->all();
        $email = strtolower(Pos::str($body['email'] ?? ''));
        $username = self::normalizeUsername($body['username'] ?? '');

        $neutral = response()->json([
            'ok' => true,
            'message' => 'If an account matches, a reset link was sent to your email. Check your inbox and spam folder.',
        ]);

        if ($email === '' && $username === '') return $neutral;

        $query = User::query();
        if ($username !== '') $query->where('username', $username);
        if ($email !== '') $query->where('email', $email);
        $user = $query->first();

        // No account, or an account with no email on file — nothing to send to,
        // but the caller is told the same thing either way.
        if (!$user || !$user->email) return $neutral;
        if ($user->status === User::STATUS_DENIED) return $neutral;

        $token = bin2hex(random_bytes(32));          // 64 hex chars
        $hash = hash('sha256', $token);

        DB::transaction(function () use ($user, $hash, $request) {
            // Issuing a new link kills every outstanding one, so an older email
            // that leaks later is already dead.
            DB::table('auth_password_resets')
                ->where('user_id', $user->id)
                ->whereNull('used_at')
                ->whereNull('invalidated_at')
                ->update(['invalidated_at' => now()]);

            DB::table('auth_password_resets')->insert([
                'user_id' => $user->id,
                'email' => $user->email,
                'token_hash' => $hash,
                'expires_at' => now()->addMinutes(self::RESET_TTL_MINUTES),
                'requested_ip' => $request->ip(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        $this->sendResetEmail($user, $token);

        return $neutral;
    }

    /**
     * POST /auth/reset-password  {email, token, password, confirm}
     *
     * The token is the only proof required, so this works in any browser with
     * no session. It is single use, expires in an hour, and completing it
     * signs the account out everywhere — a reset is the standard response to
     * "someone else is in my account", so it has to actually evict them.
     */
    public function resetPassword(Request $request)
    {
        $body = $request->json()->all();
        $email = strtolower(Pos::str($body['email'] ?? ''));
        $token = strtolower(trim((string) ($body['token'] ?? '')));
        $password = (string) ($body['password'] ?? '');
        $confirm = array_key_exists('confirm', $body) ? (string) $body['confirm'] : null;

        $invalid = 'This reset link is invalid or has expired. Request a new one.';

        if (!preg_match('/^[0-9a-f]{64}$/', $token) || $email === '') {
            return $this->fail($invalid, 400);
        }

        $hash = hash('sha256', $token);
        $row = DB::table('auth_password_resets')->where('token_hash', $hash)->first();

        if (!$row
            || $row->used_at !== null
            || $row->invalidated_at !== null
            || strtolower((string) $row->email) !== $email
            || now()->greaterThan($row->expires_at)) {
            return $this->fail($invalid, 400);
        }

        $user = User::find($row->user_id);
        if (!$user) return $this->fail($invalid, 400);

        if ($err = self::newPasswordError($password, $confirm, [$user->username, explode('@', (string) $user->email)[0] ?? ''])) {
            return $this->fail($err);
        }
        if (Hash::check($password, $user->password)) {
            return $this->fail('Choose a password you have not used before.');
        }

        DB::transaction(function () use ($user, $password, $row) {
            DB::table('auth_password_resets')->where('id', $row->id)->update([
                'used_at' => now(),
                'updated_at' => now(),
            ]);
            $user->password = $password;
            $user->must_change_password = false;
            $user->save();
            $user->tokens()->delete();          // sign out everywhere
        });

        Log::info('auth.password_reset', ['username' => $user->username, 'ip' => $request->ip()]);

        $this->sendPasswordChangedEmail($user);

        return response()->json([
            'ok' => true,
            'message' => 'Password updated. Sign in with your new password.',
        ]);
    }

    // ── mail ─────────────────────────────────────────────────────────────

    private function frontendUrl(): string
    {
        return rtrim((string) env('FRONTEND_URL', config('app.url')), '/');
    }

    private function sendResetEmail(User $user, string $token): void
    {
        $link = $this->frontendUrl() . '/reset-password.html?token=' . $token
            . '&email=' . urlencode((string) $user->email);

        $text = "Namaste {$user->name},\n\n"
            . "We received a request to reset the password for your SubarnaPasal shop \"{$user->username}\".\n\n"
            . "Open this link to choose a new password:\n{$link}\n\n"
            . 'This link works once and expires in ' . self::RESET_TTL_MINUTES . " minutes.\n\n"
            . "If you did not ask for this, you can ignore this email — your password will not change.\n";

        $this->mail((string) $user->email, 'Reset your SubarnaPasal password', $text);
    }

    private function sendPasswordChangedEmail(User $user): void
    {
        if (!$user->email) return;
        $text = "Namaste {$user->name},\n\n"
            . "Your SubarnaPasal password was just changed, and every device has been signed out.\n\n"
            . "If this was not you, reset your password immediately and contact the administrator.\n";

        $this->mail((string) $user->email, 'Your SubarnaPasal password was changed', $text);
    }

    /**
     * Mail failures must never break the request. A dead SMTP box would
     * otherwise turn "reset my password" into a 500 — and, worse, into a
     * signal that the address exists.
     */
    private function mail(string $to, string $subject, string $text): void
    {
        try {
            Mail::raw($text, function ($message) use ($to, $subject) {
                $message->to($to)->subject($subject);
            });
        } catch (\Throwable $e) {
            Log::error('auth.mail_failed', ['to' => $to, 'error' => $e->getMessage()]);
        }
    }
}
