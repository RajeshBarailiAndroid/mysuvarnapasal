<?php

namespace App\Services;

use App\Support\Pos;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * The market gold price, captured on a schedule and kept in full.
 *
 * `capture()` asks the metal API for the current quote and stores one row in
 * gold_price_ticks. `series()` reads it back for a chart: the last 24 hours
 * at full resolution, longer ranges bucketed so a six-month chart is a few
 * hundred points rather than seventeen thousand.
 *
 * Two things are deliberate:
 *  - Rows are never deleted. "Full history" means full.
 *  - NPR conversion happens at capture time and the FX rate used is stored
 *    with the row, so the history is a record of what the price *was*, not a
 *    number that silently shifts whenever the USD rate in .env changes.
 */
class GoldPriceHistory
{
    /** How long a reading stays "fresh" before a read will trigger a capture. */
    public const STALE_SECONDS = 15 * 60;

    /** Bucket widths, in seconds, per chart range. 24h is unbucketed. */
    public const RANGES = [
        '24h' => ['seconds' => 24 * 3600, 'bucket' => 0],
        'week' => ['seconds' => 7 * 24 * 3600, 'bucket' => 3600],
        'month' => ['seconds' => 30 * 24 * 3600, 'bucket' => 6 * 3600],
        '6m' => ['seconds' => 182 * 24 * 3600, 'bucket' => 24 * 3600],
    ];

    public static function normalizeRange($range): string
    {
        $r = strtolower(trim((string) $range));
        return isset(self::RANGES[$r]) ? $r : '24h';
    }

    /**
     * Fetch the live quote and store it. Returns the stored row, or null when
     * the API is not configured. Throws when the API call itself fails.
     *
     * A quote identical to the previous row less than a minute old is not
     * stored twice — that only happens when two schedulers overlap.
     */
    public static function capture(): ?array
    {
        if (!MetalRates::isConfigured()) return null;

        $live = MetalRates::getLiveRates('USD');
        $goldOz = Pos::numOrNull($live['gold']['perOz'] ?? null);
        if ($goldOz === null || $goldOz <= 0) throw new \RuntimeException('Metal API returned no gold price.');
        $silverOz = Pos::numOrNull($live['silver']['perOz'] ?? null);

        $nprPerUsd = SharedRates::nprPerUnit('USD');
        $goldPerGram = $goldOz / MetalRates::TROY_OZ_GRAMS * $nprPerUsd;
        $goldPerTola = $goldPerGram * Pos::TOLA_GRAMS;
        $silverPerTola = $silverOz !== null ? $silverOz / MetalRates::TROY_OZ_GRAMS * $nprPerUsd * Pos::TOLA_GRAMS : null;

        $row = [
            'captured_at' => gmdate('Y-m-d H:i:s'),
            'gold_usd_per_oz' => round($goldOz, 4),
            'silver_usd_per_oz' => $silverOz !== null ? round($silverOz, 4) : null,
            'npr_per_usd' => round($nprPerUsd, 4),
            'gold_npr_per_tola' => round($goldPerTola, 2),
            'gold_npr_per_gram' => round($goldPerGram, 2),
            'silver_npr_per_tola' => $silverPerTola !== null ? round($silverPerTola, 2) : null,
            'source' => substr((string) ($live['source'] ?? 'gold-api.com'), 0, 40),
            'quote_at' => substr((string) ($live['updatedAt'] ?? ''), 0, 40) ?: null,
        ];

        $last = DB::table('gold_price_ticks')->orderByDesc('captured_at')->orderByDesc('id')->first();
        if ($last
            && (float) $last->gold_usd_per_oz === (float) $row['gold_usd_per_oz']
            && strtotime($last->captured_at . ' UTC') > time() - 60) {
            return self::present($last);
        }

        $id = DB::table('gold_price_ticks')->insertGetId($row);
        return self::present((object) array_merge($row, ['id' => $id]));
    }

    /**
     * Capture only when the newest row is older than [STALE_SECONDS]. Reads
     * call this so the chart is never empty just because the cron job has not
     * been set up yet; a cache lock stops a burst of readers all fetching.
     */
    public static function captureIfStale(): void
    {
        $last = DB::table('gold_price_ticks')->max('captured_at');
        if ($last && strtotime($last . ' UTC') > time() - self::STALE_SECONDS) return;
        // After a failed fetch, leave the API alone for five minutes rather
        // than making every reader wait out the timeout again.
        if (Cache::has('gold-price:capture-failed')) return;
        if (!Cache::add('gold-price:capturing', 1, 60)) return;
        try {
            self::capture();
        } catch (\Throwable $err) {
            // Best-effort: the chart shows what it has and a later read retries.
            Cache::put('gold-price:capture-failed', 1, 5 * 60);
        } finally {
            Cache::forget('gold-price:capturing');
        }
    }

    public static function latest(): ?array
    {
        $row = DB::table('gold_price_ticks')->orderByDesc('captured_at')->orderByDesc('id')->first();
        return $row ? self::present($row) : null;
    }

    /**
     * The chart payload for one range.
     *
     * points: oldest → newest. For bucketed ranges each point is the LAST
     * reading in its bucket (a closing price), with the bucket's high and
     * low alongside so the table can show the day's spread.
     */
    public static function series(string $range): array
    {
        $range = self::normalizeRange($range);
        $spec = self::RANGES[$range];
        $since = gmdate('Y-m-d H:i:s', time() - $spec['seconds']);

        $rows = DB::table('gold_price_ticks')
            ->where('captured_at', '>=', $since)
            ->orderBy('captured_at')
            ->orderBy('id')
            ->get();

        $points = [];
        if ($spec['bucket'] === 0) {
            foreach ($rows as $r) {
                $p = self::present($r);
                $p['high'] = $p['goldPerTola'];
                $p['low'] = $p['goldPerTola'];
                $points[] = $p;
            }
        } else {
            $buckets = [];
            foreach ($rows as $r) {
                $t = strtotime($r->captured_at . ' UTC');
                $key = intdiv($t, $spec['bucket']);
                $p = self::present($r);
                if (!isset($buckets[$key])) {
                    $buckets[$key] = $p + ['high' => $p['goldPerTola'], 'low' => $p['goldPerTola']];
                } else {
                    $b = &$buckets[$key];
                    $b['high'] = max($b['high'], $p['goldPerTola']);
                    $b['low'] = min($b['low'], $p['goldPerTola']);
                    // Later rows replace the close; the bucket keeps its span.
                    foreach ($p as $k => $v) $b[$k] = $v;
                    unset($b);
                }
            }
            ksort($buckets);
            $points = array_values($buckets);
        }

        $latest = self::latest();
        $first = $points[0] ?? null;
        $last = $points[count($points) - 1] ?? null;
        $change = ($first && $last) ? round($last['goldPerTola'] - $first['goldPerTola'], 2) : 0;
        $changePct = ($first && $first['goldPerTola'] > 0) ? round($change / $first['goldPerTola'] * 100, 2) : 0;
        $tolas = array_column($points, 'goldPerTola');

        return [
            'range' => $range,
            'bucketSeconds' => $spec['bucket'],
            'latest' => $latest,
            'change' => $change,
            'changePercent' => $changePct,
            'high' => $tolas ? max(array_column($points, 'high')) : null,
            'low' => $tolas ? min(array_column($points, 'low')) : null,
            'count' => count($points),
            'totalRows' => (int) DB::table('gold_price_ticks')->count(),
            'points' => $points,
        ];
    }

    private static function present(object $r): array
    {
        return [
            'id' => (int) ($r->id ?? 0),
            'capturedAt' => gmdate('Y-m-d\TH:i:s\Z', strtotime($r->captured_at . ' UTC')),
            'goldPerTola' => (float) $r->gold_npr_per_tola,
            'goldPerGram' => (float) $r->gold_npr_per_gram,
            'silverPerTola' => isset($r->silver_npr_per_tola) ? (float) $r->silver_npr_per_tola : null,
            'goldUsdPerOz' => (float) $r->gold_usd_per_oz,
            'nprPerUsd' => (float) $r->npr_per_usd,
            'source' => (string) ($r->source ?? ''),
        ];
    }
}
