<?php

namespace App\Services;

use App\Support\Pos;
use Illuminate\Support\Facades\Cache;

/**
 * Live foreign-exchange rates, expressed the way the whole app thinks about
 * money: NPR per one unit of the foreign currency.
 *
 * One server-side source so the web and the phone convert with the SAME
 * number. Before this, three things disagreed: the hard-coded 133/98 in the
 * browser, a per-shop `settings.fxRates` typed by hand, and FX_NPR_PER_USD in
 * the server .env used to price the market gold feed. A shop could see one
 * figure on the phone and another on the web for the same gold.
 *
 * Never throws. If the provider is unreachable the last good reading is used,
 * then the .env pin, then the built-in constant — so a conversion is always
 * available and money never silently becomes zero.
 */
class FxRates
{
    /** How long a live reading is served before refetching. */
    public const CACHE_SECONDS = 3600;

    /** A good reading is remembered far longer, purely as an outage fallback. */
    public const LAST_GOOD_SECONDS = 14 * 24 * 3600;

    private const CACHE_KEY = 'fx.rates.current';
    private const LAST_GOOD_KEY = 'fx.rates.last-good';

    /** Free, no API key, updates daily. */
    private const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

    /**
     * The rate table every client should use: NPR per unit.
     * Shape: ['rates' => ['USD' => f, 'CAD' => f, 'NPR' => 1.0],
     *         'source' => string, 'updatedAt' => iso|null, 'live' => bool]
     */
    public static function payload(): array
    {
        $cached = Cache::get(self::CACHE_KEY);
        if (is_array($cached) && !empty($cached['rates']['USD'])) return $cached;

        $fresh = self::fetch();
        if ($fresh !== null) {
            Cache::put(self::CACHE_KEY, $fresh, self::CACHE_SECONDS);
            Cache::put(self::LAST_GOOD_KEY, $fresh, self::LAST_GOOD_SECONDS);
            return $fresh;
        }

        $lastGood = Cache::get(self::LAST_GOOD_KEY);
        if (is_array($lastGood) && !empty($lastGood['rates']['USD'])) {
            return ['live' => false] + $lastGood;
        }

        return self::fallback();
    }

    /** Just the NPR-per-unit table. */
    public static function table(): array
    {
        return self::payload()['rates'];
    }

    public static function nprPerUnit(string $code): float
    {
        $table = self::table();
        $key = strtoupper($code);
        return (float) ($table[$key] ?? $table['USD']);
    }

    /** Force a refetch. Called by the capture command so the cache stays warm. */
    public static function refresh(): array
    {
        Cache::forget(self::CACHE_KEY);
        return self::payload();
    }

    /**
     * The .env pin, then the built-in constant. FX_NPR_PER_USD is deliberately
     * a FALLBACK, not an override: it was set to the same number as the old
     * hard-coded default, so treating it as an override would pin the app to a
     * stale rate forever and defeat the point of fetching a live one.
     */
    private static function fallback(): array
    {
        $envUsd = Pos::num(env('FX_NPR_PER_USD'), 0);
        $envCad = Pos::num(env('FX_NPR_PER_CAD'), 0);
        return [
            'rates' => [
                'USD' => $envUsd > 0 ? (float) $envUsd : (float) Pos::DEFAULT_FX_RATES['USD'],
                'CAD' => $envCad > 0 ? (float) $envCad : (float) Pos::DEFAULT_FX_RATES['CAD'],
                'NPR' => 1.0,
            ],
            'source' => $envUsd > 0 ? 'env' : 'default',
            'updatedAt' => null,
            'live' => false,
        ];
    }

    /** Returns null on any failure — the caller falls back. */
    private static function fetch(): ?array
    {
        try {
            $ch = curl_init(self::ENDPOINT);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT_MS => 6000,
                CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: SubarnaPasal/1.0'],
            ]);
            $body = curl_exec($ch);
            $errno = curl_errno($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            if ($errno || $status < 200 || $status >= 300) return null;

            $data = json_decode((string) $body, true);
            if (!is_array($data) || ($data['result'] ?? '') !== 'success') return null;

            // Base is USD, so rates.NPR is already NPR per USD. Another
            // currency is NPR per USD divided by that currency per USD.
            $rates = $data['rates'] ?? [];
            $nprPerUsd = Pos::num($rates['NPR'] ?? 0, 0);
            $cadPerUsd = Pos::num($rates['CAD'] ?? 0, 0);
            if ($nprPerUsd <= 0) return null;

            $table = ['USD' => round((float) $nprPerUsd, 4), 'NPR' => 1.0];
            $table['CAD'] = $cadPerUsd > 0
                ? round((float) $nprPerUsd / (float) $cadPerUsd, 4)
                : (float) Pos::DEFAULT_FX_RATES['CAD'];

            return [
                'rates' => $table,
                'source' => 'open.er-api.com',
                'updatedAt' => isset($data['time_last_update_unix'])
                    ? gmdate('Y-m-d\TH:i:s', (int) $data['time_last_update_unix']) . '.000Z'
                    : Pos::nowIso(),
                'live' => true,
            ];
        } catch (\Throwable $e) {
            return null;
        }
    }
}
