<?php

namespace App\Services;

use App\Support\Pos;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Local-first auto backup.
 *
 * The shop's desktop install is the source of truth: every change is saved
 * locally first (SQLite), then this service pushes the full per-user store
 * to the central server (the same Laravel app deployed with MySQL) whenever
 * the internet is available. Content hashes make repeat pushes cheap, and a
 * short backoff avoids slowing the POS down while offline.
 *
 * Configure in .env:
 *   SYNC_SERVER_URL=https://your-server.example.com
 *   SYNC_API_TOKEN=<same long random token on both sides>
 */
class SyncService
{
    private const BACKOFF_CACHE_KEY = 'sync:offline-until';
    private const LOCK_CACHE_KEY = 'sync:running';
    public const BACKOFF_SECONDS = 60;

    public function __construct(private Store $store)
    {
    }

    public static function serverUrl(): string
    {
        return rtrim((string) env('SYNC_SERVER_URL', ''), '/');
    }

    public static function token(): string
    {
        return trim((string) env('SYNC_API_TOKEN', ''));
    }

    public static function isConfigured(): bool
    {
        return self::serverUrl() !== '' && self::token() !== '';
    }

    /** Called after every data-changing request (terminable middleware). */
    public function pushSoon(): void
    {
        if (!self::isConfigured()) return;
        // Recently offline? Don't retry on every keystroke.
        if (Cache::get(self::BACKOFF_CACHE_KEY)) return;
        $this->run();
    }

    /** Run one sync pass. Returns a status summary. */
    public function run(): array
    {
        if (!self::isConfigured()) {
            return ['ok' => false, 'reason' => 'not_configured'];
        }
        // One sync at a time.
        $lock = Cache::lock(self::LOCK_CACHE_KEY, 120);
        if (!$lock->get()) return ['ok' => false, 'reason' => 'already_running'];
        try {
            $results = [];
            foreach ($this->localUserIds() as $userId) {
                $results[$userId] = $this->pushUser($userId);
            }
            $results['_shared'] = $this->pushShared();
            $results['_users'] = $this->pushAccounts();
            $ok = !in_array(false, array_map(fn ($r) => $r['ok'] ?? true, $results), true);
            return ['ok' => $ok, 'results' => $results, 'at' => Pos::nowIso()];
        } finally {
            $lock->release();
        }
    }

    public function status(): array
    {
        $rows = DB::table('sync_status')->get();
        return [
            'configured' => self::isConfigured(),
            'serverUrl' => self::serverUrl() !== '' ? preg_replace('#^(https?://[^/]+).*$#', '$1', self::serverUrl()) : null,
            'offlineUntil' => Cache::get(self::BACKOFF_CACHE_KEY),
            'entries' => $rows->map(fn ($r) => [
                'key' => $r->key,
                'lastPushedAt' => $r->last_pushed_at,
                'lastError' => $r->last_error,
                'lastErrorAt' => $r->last_error_at,
            ])->all(),
        ];
    }

    private function localUserIds(): array
    {
        return DB::table('settings')->pluck('user_id')->all();
    }

    private function pushUser(string $userId): array
    {
        $store = $this->store->read($userId);
        return $this->pushPayload("user:{$userId}", '/api/sync/push', [
            'kind' => 'store', 'userId' => $userId, 'store' => $store,
        ]);
    }

    private function pushShared(): array
    {
        $shared = SharedRates::read();
        return $this->pushPayload('shared-rates', '/api/sync/push', [
            'kind' => 'shared_rates', 'sharedRates' => $shared,
        ]);
    }

    private function pushAccounts(): array
    {
        // SECURITY: password hashes and remember tokens never leave this
        // device. The server-side push handler rejects them too.
        $users = DB::table('users')->get()
            ->map(fn ($u) => array_diff_key((array) $u, array_flip(['password', 'remember_token'])))
            ->all();
        if (!$users) return ['ok' => true, 'skipped' => 'no_users'];
        return $this->pushPayload('accounts', '/api/sync/push', [
            'kind' => 'users', 'users' => $users,
        ]);
    }

    private function pushPayload(string $key, string $path, array $payload): array
    {
        $body = json_encode($payload);
        $hash = sha1($body);
        $row = DB::table('sync_status')->where('key', $key)->first();
        if ($row && $row->last_pushed_hash === $hash) {
            return ['ok' => true, 'skipped' => 'unchanged'];
        }
        [$ok, $error] = $this->post(self::serverUrl() . $path, $body);
        $now = Pos::nowIso();
        if ($ok) {
            DB::table('sync_status')->updateOrInsert(['key' => $key], [
                'last_pushed_hash' => $hash, 'last_pushed_at' => $now,
                'last_error' => null, 'last_error_at' => null,
            ]);
            Cache::forget(self::BACKOFF_CACHE_KEY);
            return ['ok' => true];
        }
        DB::table('sync_status')->updateOrInsert(['key' => $key], [
            'last_error' => mb_substr((string) $error, 0, 500), 'last_error_at' => $now,
        ]);
        // Likely offline — back off for a bit so the POS stays snappy.
        Cache::put(self::BACKOFF_CACHE_KEY, $now, self::BACKOFF_SECONDS);
        Log::info("Sync push failed for {$key}: {$error}");
        return ['ok' => false, 'error' => $error];
    }

    /** Pull a user's store from the server (first-time restore). */
    public function pull(string $userId): array
    {
        if (!self::isConfigured()) return ['ok' => false, 'reason' => 'not_configured'];
        $url = self::serverUrl() . '/api/sync/pull?userId=' . urlencode($userId);
        [$ok, $errorOrBody] = $this->request('GET', $url, null);
        if (!$ok) return ['ok' => false, 'error' => $errorOrBody];
        $data = json_decode($errorOrBody, true);
        if (!is_array($data) || !is_array($data['store'] ?? null)) {
            return ['ok' => false, 'error' => 'Server returned an unexpected payload.'];
        }
        $this->store->write($userId, $data['store']);
        return ['ok' => true, 'restored' => true];
    }

    private function post(string $url, string $body): array
    {
        [$ok, $result] = $this->request('POST', $url, $body);
        return [$ok, $ok ? null : $result];
    }

    /** @return array{0: bool, 1: string} [ok, body-or-error] */
    private function request(string $method, string $url, ?string $body): array
    {
        $ch = curl_init($url);
        $headers = [
            'Accept: application/json',
            'Authorization: Bearer ' . self::token(),
        ];
        if ($body !== null) $headers[] = 'Content-Type: application/json';
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
        ]);
        if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        $responseBody = curl_exec($ch);
        $errno = curl_errno($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($errno) return [false, 'Network: ' . curl_strerror($errno)];
        if ($status < 200 || $status >= 300) {
            $msg = null;
            $decoded = json_decode((string) $responseBody, true);
            if (is_array($decoded)) $msg = $decoded['error'] ?? $decoded['message'] ?? null;
            return [false, "Server responded {$status}" . ($msg ? ": {$msg}" : '')];
        }
        return [true, (string) $responseBody];
    }
}
