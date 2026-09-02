<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Services\SyncService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Server-side licensing for the desktop app.
 *
 * Admin endpoints (Bearer LICENSE_ADMIN_TOKEN — server-side only):
 *   POST /api/license/issue   {shopName, days|expiry, note?}  → creates + returns a key
 *   GET  /api/license/list                                     → all keys + activations
 *   POST /api/license/revoke  {id}                             → remote-kill a license
 *   POST /api/license/unrevoke {id}
 *
 * App endpoints (public, throttled):
 *   POST /api/license/activate {key, deviceId, deviceName?, appVersion?}
 *       First-run ONLINE activation. Verifies the key's Ed25519 signature,
 *       records shop + device in the database (so the admin can see every
 *       activation), and returns a RECEIPT — an Ed25519 signature over
 *       {key-hash, deviceId, time} that only this server (holder of
 *       LICENSE_PRIVATE_SEED) can produce. The app refuses to run without a
 *       valid receipt, so keys cannot be activated without the server.
 *   POST /api/license/check    {key, deviceId}
 *       Periodic re-validation while online; reports revocation.
 *
 * Env (server .env):
 *   LICENSE_PRIVATE_SEED  base64 32-byte Ed25519 seed (KEEP SECRET)
 *   LICENSE_PUBLIC_KEY    base64 32-byte Ed25519 public key
 */
class LicenseController extends ApiController
{
    private function adminAuthorized(Request $request): bool
    {
        $token = trim((string) env('LICENSE_ADMIN_TOKEN', ''));
        if ($token === '') return false;
        $header = (string) $request->header('Authorization', '');
        $given = str_starts_with($header, 'Bearer ') ? substr($header, 7) : '';
        return $given !== '' && hash_equals($token, $given);
    }

    private function seed(): ?string
    {
        $b64 = (string) env('LICENSE_PRIVATE_SEED', '');
        if ($b64 === '') return null;
        $raw = base64_decode($b64, true);
        return ($raw !== false && strlen($raw) === SODIUM_CRYPTO_SIGN_SEEDBYTES) ? $raw : null;
    }

    private function publicKey(): ?string
    {
        $b64 = (string) env('LICENSE_PUBLIC_KEY', '');
        if ($b64 === '') return null;
        $raw = base64_decode($b64, true);
        return ($raw !== false && strlen($raw) === SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) ? $raw : null;
    }

    private function secretKey(): ?string
    {
        $seed = $this->seed();
        if ($seed === null) return null;
        $pair = sodium_crypto_sign_seed_keypair($seed);
        return sodium_crypto_sign_secretkey($pair);
    }

    private static function b64u(string $bin): string
    {
        return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
    }

    private static function b64uDecode(string $s)
    {
        return base64_decode(strtr($s, '-_', '+/'), false);
    }

    /** Verify an SP.<payload>.<sig> key. Returns payload array or null. */
    private function verifyKey(string $key): ?array
    {
        $pub = $this->publicKey();
        if ($pub === null) return null;
        $key = preg_replace('/\s+/', '', $key);
        $parts = explode('.', $key);
        if (count($parts) !== 3 || $parts[0] !== 'SP') return null;
        $payload = self::b64uDecode($parts[1]);
        $sig = self::b64uDecode($parts[2]);
        if ($payload === false || $sig === false || strlen($sig) !== SODIUM_CRYPTO_SIGN_BYTES) return null;
        if (!sodium_crypto_sign_verify_detached($sig, $payload, $pub)) return null;
        $data = json_decode($payload, true);
        if (!is_array($data) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $data['e'] ?? '')) return null;
        return $data;
    }

    // ── Shared internals ─────────────────────────────────────────────────

    /** Sign a new SP.* key and store its row. Returns [key, licenseId]. */
    private function issueKey(string $sk, string $shopName, string $expiry, ?string $note): array
    {
        $payload = json_encode([
            'n' => $shopName,
            'e' => $expiry,
            'i' => now()->toDateString(),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $sig = sodium_crypto_sign_detached($payload, $sk);
        $key = 'SP.' . self::b64u($payload) . '.' . self::b64u($sig);

        $id = DB::table('licenses')->insertGetId([
            'shop_name' => $shopName,
            'key_hash' => hash('sha256', $key),
            'license_key' => $key,
            'expiry' => $expiry,
            'revoked' => false,
            'note' => $note,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return [$key, $id];
    }

    private function recordActivation(int $licenseId, string $deviceId, array $body): void
    {
        DB::table('license_activations')->updateOrInsert(
            ['license_id' => $licenseId, 'device_id' => $deviceId],
            [
                'device_name' => mb_substr((string) ($body['deviceName'] ?? ''), 0, 190),
                'app_version' => mb_substr((string) ($body['appVersion'] ?? ''), 0, 30),
                'activated_at' => now(),
                'last_seen_at' => now(),
                'updated_at' => now(),
                'created_at' => now(),
            ]
        );
    }

    /** Ed25519 receipt proving this server approved this key on this device. */
    private function receiptFor(string $sk, string $key, string $deviceId): string
    {
        $receiptPayload = json_encode([
            'v' => 1,
            'kh' => hash('sha256', $key),
            'd' => $deviceId,
            't' => now()->toIso8601String(),
        ], JSON_UNESCAPED_SLASHES);
        $receiptSig = sodium_crypto_sign_detached($receiptPayload, $sk);
        return self::b64u($receiptPayload) . '.' . self::b64u($receiptSig);
    }

    // ── App: first-run SIGNUP → account + 1-year key + activation ────────

    public function signup(Request $request)
    {
        // No client uses this today, and it would otherwise be an open,
        // unauthenticated account-and-licence factory that skips the
        // mobile-only signup rule and the password policy. Off unless the
        // operator turns it on deliberately.
        if (!filter_var(env('LICENSE_SIGNUP_ENABLED', false), FILTER_VALIDATE_BOOLEAN)) {
            return $this->fail('Not found.', 404);
        }
        $sk = $this->secretKey();
        if ($sk === null) return $this->fail('This server is not configured for license activation.', 500);

        $body = $request->json()->all();
        $shopName = trim((string) ($body['shopName'] ?? ''));
        $username = preg_replace('/\s+/', '', strtolower(trim((string) ($body['username'] ?? ''))));
        $phone = trim((string) ($body['phone'] ?? ''));
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');
        $deviceId = trim((string) ($body['deviceId'] ?? ''));

        if ($shopName === '') return $this->fail('Enter your shop name.');
        if (!preg_match('/^[a-z0-9_]{3,24}$/', $username)) {
            return $this->fail('Username must be 3–24 characters (letters, numbers, underscore).');
        }
        if (strlen($password) < 8 || strlen($password) > 128) {
            return $this->fail('Password must be at least 8 characters.');
        }
        if ($email !== '' && !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email)) return $this->fail('Enter a valid email address.');
        if ($email !== '' && User::whereRaw('LOWER(email) = ?', [$email])->exists()) {
            return $this->fail('An account with that email address already exists.', 409);
        }
        if ($deviceId === '' || strlen($deviceId) > 64) return $this->fail('deviceId is required.');
        if (User::where('username', $username)->exists()) {
            return $this->fail('That username is already taken. If this is your shop, use "Already have a license key?" instead.', 409);
        }

        $user = User::create([
            'name' => $shopName,
            'username' => $username,
            'email' => $email !== '' ? $email : null,
            'phone' => $phone !== '' ? $phone : null,
            'password' => $password,
        ]);

        // One-year license, issued automatically and tied to this signup.
        $expiry = now()->addYear()->toDateString();
        [$key, $licenseId] = $this->issueKey($sk, $shopName, $expiry, 'signup: ' . $username . ' (user #' . $user->id . ')');
        $this->recordActivation($licenseId, $deviceId, $body);

        return response()->json([
            'ok' => true,
            'key' => $key,
            'receipt' => $this->receiptFor($sk, $key, $deviceId),
            'expiry' => $expiry,
            'shopName' => $shopName,
            'username' => $username,
        ], 201);
    }

    // ── Admin: issue a new key ───────────────────────────────────────────

    public function issue(Request $request)
    {
        if (!$this->adminAuthorized($request)) return $this->fail('Admin token invalid.', 401);
        $sk = $this->secretKey();
        if ($sk === null) return $this->fail('LICENSE_PRIVATE_SEED is not configured on this server.', 500);

        $body = $request->json()->all();
        $shopName = trim((string) ($body['shopName'] ?? ''));
        if ($shopName === '') return $this->fail('shopName is required.');

        $expiry = (string) ($body['expiry'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $expiry)) {
            $days = (int) ($body['days'] ?? 0);
            if ($days < 1) return $this->fail('Provide expiry (YYYY-MM-DD) or days (>0).');
            $expiry = now()->addDays($days)->toDateString();
        }

        [$key, $id] = $this->issueKey($sk, $shopName, $expiry, isset($body['note']) ? (string) $body['note'] : null);

        return response()->json(['ok' => true, 'id' => $id, 'shopName' => $shopName, 'expiry' => $expiry, 'key' => $key]);
    }

    // ── Admin: list / revoke ─────────────────────────────────────────────

    public function list(Request $request)
    {
        if (!$this->adminAuthorized($request)) return $this->fail('Admin token invalid.', 401);
        $licenses = DB::table('licenses')->orderByDesc('id')->get()->map(function ($l) {
            $l->activations = DB::table('license_activations')
                ->where('license_id', $l->id)->orderByDesc('activated_at')->get();
            // SECURITY: never bulk-dump working license keys. One request used
            // to return every customer's key in plaintext. Use POST
            // /api/license/reveal {id} to fetch a single key on demand.
            $l->license_key_masked = self::maskKey((string) ($l->license_key ?? ''));
            unset($l->license_key);
            return $l;
        });
        return response()->json(['ok' => true, 'licenses' => $licenses]);
    }

    /** Show only enough of a key to tell two rows apart. */
    private static function maskKey(string $key): string
    {
        return $key === '' ? '' : 'SP.…' . substr($key, -8);
    }

    /** Admin: reveal ONE license key (for resending it to a shop). */
    public function reveal(Request $request)
    {
        if (!$this->adminAuthorized($request)) return $this->fail('Admin token invalid.', 401);
        $id = (int) ($request->json()->all()['id'] ?? 0);
        $license = DB::table('licenses')->where('id', $id)->first();
        if (!$license) return $this->fail('License not found.', 404);
        return response()->json(['ok' => true, 'id' => $id, 'key' => $license->license_key]);
    }

    public function revoke(Request $request)
    {
        return $this->setRevoked($request, true);
    }

    public function unrevoke(Request $request)
    {
        return $this->setRevoked($request, false);
    }

    private function setRevoked(Request $request, bool $flag)
    {
        if (!$this->adminAuthorized($request)) return $this->fail('Admin token invalid.', 401);
        $id = (int) ($request->json()->all()['id'] ?? 0);
        $n = DB::table('licenses')->where('id', $id)->update(['revoked' => $flag, 'updated_at' => now()]);
        return $n ? response()->json(['ok' => true, 'id' => $id, 'revoked' => $flag])
                  : $this->fail('License not found.', 404);
    }

    // ── App: first-run online activation ─────────────────────────────────

    public function activate(Request $request)
    {
        $sk = $this->secretKey();
        if ($sk === null) return $this->fail('This server is not configured for license activation.', 500);

        $body = $request->json()->all();
        $key = preg_replace('/\s+/', '', (string) ($body['key'] ?? ''));
        $deviceId = trim((string) ($body['deviceId'] ?? ''));
        if ($key === '' || $deviceId === '' || strlen($deviceId) > 64) {
            return $this->fail('key and deviceId are required.');
        }

        $data = $this->verifyKey($key);
        if ($data === null) return $this->fail('This license key is not valid.', 422);

        $keyHash = hash('sha256', $key);
        $license = DB::table('licenses')->where('key_hash', $keyHash)->first();
        if (!$license) {
            // Key was signed with our private key but issued outside the DB
            // (e.g. the offline make-license.js script) — register it so the
            // admin can see it.
            $id = DB::table('licenses')->insertGetId([
                'shop_name' => (string) ($data['n'] ?? ''),
                'key_hash' => $keyHash,
                'license_key' => $key,
                'expiry' => $data['e'],
                'revoked' => false,
                'note' => 'auto-registered at activation',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $license = DB::table('licenses')->where('id', $id)->first();
        }

        if ($license->revoked) return $this->fail('This license has been disabled. Please contact SubarnaPasal.', 403);
        if ($data['e'] < now()->subDays(7)->toDateString()) {
            return $this->fail('This license key expired on ' . $data['e'] . '. Please request a renewal key.', 403);
        }

        $this->recordActivation((int) $license->id, $deviceId, $body);

        return response()->json(['ok' => true, 'receipt' => $this->receiptFor($sk, $key, $deviceId), 'expiry' => $data['e']]);
    }

    // ── App: periodic online re-check (revocation) ───────────────────────

    public function check(Request $request)
    {
        $body = $request->json()->all();
        $key = preg_replace('/\s+/', '', (string) ($body['key'] ?? ''));
        $deviceId = trim((string) ($body['deviceId'] ?? ''));
        if ($key === '') return $this->fail('key is required.');

        $keyHash = hash('sha256', $key);
        $license = DB::table('licenses')->where('key_hash', $keyHash)->first();
        $revoked = $license ? (bool) $license->revoked : false;

        if ($license && $deviceId !== '') {
            DB::table('license_activations')
                ->where('license_id', $license->id)->where('device_id', $deviceId)
                ->update(['last_seen_at' => now(), 'updated_at' => now()]);
        }

        return response()->json(['ok' => true, 'revoked' => $revoked]);
    }
}
