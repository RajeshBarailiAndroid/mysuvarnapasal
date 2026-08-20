<?php

namespace App\Http\Controllers\Api;

use App\Http\Middleware\AttachUser;
use App\Models\User;
use App\Support\Pos;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

/**
 * Username/password auth using Laravel Sanctum personal access tokens.
 * Endpoint paths and response shapes mirror the original Express auth
 * router so the frontend needs minimal changes.
 */
class AuthController extends ApiController
{
    public function config()
    {
        return response()->json([
            'enabled' => AttachUser::authEnabled(),
            'driver' => 'sanctum',
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

    private static function isValidPassword(string $password): bool
    {
        $len = strlen($password);
        return $len >= 6 && $len <= 128;
    }

    private function sessionPayload(User $user, string $token): array
    {
        return [
            'access_token' => $token,
            'token_type' => 'bearer',
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

    public function signup(Request $request)
    {
        if (!AttachUser::authEnabled()) return $this->fail('Sign-in is not configured yet.', 503);
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
        if (!self::isValidPassword($password)) return $this->fail('Password must be at least 6 characters.');
        if (User::where('username', $username)->exists()) return $this->fail('That username is already taken.', 409);
        $user = User::create([
            'name' => $fullName,
            'username' => $username,
            'email' => $email !== '' ? strtolower($email) : null,
            'phone' => $phone !== '' ? $phone : null,
            'password' => $password,
        ]);
        $this->store->ensureUserSettings((string) $user->id);
        $token = $user->createToken('subarnapasal')->plainTextToken;
        return response()->json(['ok' => true, 'session' => $this->sessionPayload($user, $token)], 201);
    }

    public function login(Request $request)
    {
        if (!AttachUser::authEnabled()) return $this->fail('Sign-in is not configured yet.', 503);
        $body = $request->json()->all();
        $username = self::normalizeUsername($body['username'] ?? '');
        $password = (string) ($body['password'] ?? '');
        if (!self::isValidUsername($username) || !self::isValidPassword($password)) {
            return $this->fail('Incorrect username or password.', $username === '' ? 400 : 400);
        }
        $user = User::where('username', $username)->first();
        if (!$user || !Hash::check($password, $user->password)) {
            return $this->fail('Incorrect username or password.', 401);
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
        if (!self::isValidPassword($password)) return $this->fail('Password must be at least 6 characters.');
        if ($password !== $confirm) return $this->fail('Passwords do not match.');
        if ($password === $currentPassword) return $this->fail('Choose a different password.');
        if (!Hash::check($currentPassword, $user->password)) return $this->fail('Current password is incorrect.', 401);
        $user->password = $password;
        $user->save();
        // Sign out everywhere (like the Express global sign-out).
        $user->tokens()->delete();
        return response()->json(['ok' => true, 'message' => 'Password updated.']);
    }

    public function forgotPassword()
    {
        // Password reset email delivery is not configured in this build.
        // Kept for frontend compatibility: always responds with the generic message.
        return response()->json([
            'ok' => true,
            'message' => 'If an account matches, a reset link was sent to your email. Check your inbox and spam folder.',
        ]);
    }
}
