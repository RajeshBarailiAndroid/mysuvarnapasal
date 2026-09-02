<?php

namespace App\Services;

use App\Support\Pos;
use Illuminate\Support\Facades\DB;

/**
 * Global (cross-shop) gold price ticks + daily history, stored in the
 * shared_gold_rates table. Ported from lib/shared-rates.ts and
 * lib/capture-shared-gold-rate.ts.
 */
class SharedRates
{
    public const GLOBAL_ID = 'global';
    public const MAX_HISTORY_PER_MODE = 500;
    public const MAX_TICKS = 90000;

    /**
     * NPR per one unit of the given currency, from the live FX feed.
     *
     * This is what converts the international gold price into the NPR figure
     * every shop sees, so it must be the same number the clients display
     * prices with — see FxRates, which is the single source for both.
     */
    public static function nprPerUnit(string $code): float
    {
        return FxRates::nprPerUnit($code);
    }

    public static function displayToNpr($amount, $currency): float
    {
        $requested = strtoupper(Pos::str($currency) ?: 'USD');
        $apiCode = MetalRates::normalizeMetalCurrency($requested);
        $factor = $requested === 'NPR' ? self::nprPerUnit('USD') : self::nprPerUnit($apiCode);
        return Pos::num($amount) * $factor;
    }

    public static function localDateStr(): string
    {
        return date('Y-m-d');
    }

    private static function daySecondFromUpdatedAt(string $updatedAt): int
    {
        $t = strtotime($updatedAt);
        if ($t === false) return 0;
        return (int) date('G', $t) * 3600 + (int) date('i', $t) * 60 + (int) date('s', $t);
    }

    public static function normalizeTick(array $entry): array
    {
        $updatedAt = $entry['updatedAt'] ?? Pos::nowIso();
        $goldRatePerTola = Pos::num($entry['goldRatePerTola'] ?? 0);
        return [
            'date' => substr(Pos::str($entry['date'] ?? '') ?: substr($updatedAt, 0, 10), 0, 10),
            'updatedAt' => $updatedAt,
            'daySecond' => ($entry['daySecond'] ?? null) !== null
                ? max(0, min(86399, (int) floor(Pos::num($entry['daySecond']))))
                : self::daySecondFromUpdatedAt($updatedAt),
            'secondNum' => max(1, (int) floor(Pos::num($entry['secondNum'] ?? 1, 1) ?: 1)),
            'goldRatePerTola' => $goldRatePerTola,
            'goldRatePerGram' => Pos::num($entry['goldRatePerGram'] ?? 0) ?: Pos::round2($goldRatePerTola / Pos::TOLA_GRAMS),
            'priceMode' => ($entry['priceMode'] ?? '') === 'api' ? 'api' : 'manual',
            'saved' => !empty($entry['saved']),
        ];
    }

    public static function normalizeHistoryEntry(array $entry): array
    {
        $updatedAt = $entry['updatedAt'] ?? Pos::nowIso();
        $goldRatePerTola = Pos::num($entry['goldRatePerTola'] ?? 0);
        return [
            'date' => substr(Pos::str($entry['date'] ?? '') ?: substr($updatedAt, 0, 10), 0, 10),
            'updatedAt' => $updatedAt,
            'goldRatePerTola' => $goldRatePerTola,
            'goldRatePerGram' => Pos::num($entry['goldRatePerGram'] ?? 0) ?: Pos::round2($goldRatePerTola / Pos::TOLA_GRAMS),
            'priceMode' => ($entry['priceMode'] ?? '') === 'api' ? 'api' : 'manual',
        ];
    }

    private static function trimHistory(array $history): array
    {
        $byMode = ['manual' => [], 'api' => []];
        foreach ($history as $row) {
            $mode = ($row['priceMode'] ?? '') === 'api' ? 'api' : 'manual';
            $byMode[$mode][] = $row;
        }
        $cmp = fn ($a, $b) => strcmp($b['updatedAt'], $a['updatedAt']);
        usort($byMode['manual'], $cmp);
        usort($byMode['api'], $cmp);
        $merged = array_merge(
            array_slice($byMode['manual'], 0, self::MAX_HISTORY_PER_MODE),
            array_slice($byMode['api'], 0, self::MAX_HISTORY_PER_MODE)
        );
        usort($merged, $cmp);
        return $merged;
    }

    private static function trimTicks(array $ticks): array
    {
        $keepDates = [];
        for ($i = 0; $i < 7; $i++) $keepDates[date('Y-m-d', strtotime("-{$i} days"))] = true;
        $kept = array_values(array_filter($ticks, fn ($row) => isset($keepDates[$row['date'] ?? '']) || !empty($row['saved'])));
        usort($kept, function ($a, $b) {
            $d = ($a['daySecond'] ?? 0) <=> ($b['daySecond'] ?? 0);
            return $d !== 0 ? $d : strcmp($a['updatedAt'] ?? '', $b['updatedAt'] ?? '');
        });
        if (count($kept) <= self::MAX_TICKS) return $kept;
        return array_slice($kept, count($kept) - self::MAX_TICKS);
    }

    public static function read(): array
    {
        $row = DB::table('shared_gold_rates')->where('id', self::GLOBAL_ID)->first();
        if (!$row) return ['ticks' => [], 'history' => []];
        $ticks = json_decode($row->ticks ?? '[]', true) ?: [];
        $history = json_decode($row->history ?? '[]', true) ?: [];
        return [
            'ticks' => array_map([self::class, 'normalizeTick'], $ticks),
            'history' => array_map([self::class, 'normalizeHistoryEntry'], $history),
        ];
    }

    public static function write(array $data): array
    {
        $payload = [
            'ticks' => self::trimTicks(array_map([self::class, 'normalizeTick'], $data['ticks'] ?? [])),
            'history' => self::trimHistory(array_map([self::class, 'normalizeHistoryEntry'], $data['history'] ?? [])),
        ];
        DB::table('shared_gold_rates')->updateOrInsert(['id' => self::GLOBAL_ID], [
            'ticks' => json_encode($payload['ticks']),
            'history' => json_encode($payload['history']),
            'updated_at' => Pos::nowIso(),
        ]);
        return $payload;
    }

    public static function appendTicks(array $ticks): array
    {
        if (!$ticks) return ['count' => 0];
        $data = self::read();
        $count = 0;
        foreach ($ticks as $tick) {
            if (!is_array($tick)) continue;
            $normalized = self::normalizeTick($tick);
            $duplicate = null;
            foreach ($data['ticks'] as $i => $row) {
                if ($row['date'] === $normalized['date'] && $row['priceMode'] === $normalized['priceMode'] && $row['daySecond'] === $normalized['daySecond']) {
                    $duplicate = $i;
                    break;
                }
            }
            if ($duplicate !== null) $data['ticks'][$duplicate] = $normalized;
            else $data['ticks'][] = $normalized;
            $count++;
        }
        self::write($data);
        return ['count' => $count];
    }

    public static function appendHistory(array $entry): array
    {
        $tola = Pos::numOrNull($entry['goldRatePerTola'] ?? null);
        if ($tola === null || $tola <= 0) return ['changed' => false, 'history' => []];
        $mode = ($entry['priceMode'] ?? '') === 'api' ? 'api' : 'manual';
        $now = Pos::nowIso();
        $today = substr(Pos::str($entry['localDate'] ?? $entry['date'] ?? '') ?: substr($now, 0, 10), 0, 10);
        $gram = Pos::num($entry['goldRatePerGram'] ?? 0) ?: Pos::round2($tola / Pos::TOLA_GRAMS);
        $data = self::read();
        $history = array_map([self::class, 'normalizeHistoryEntry'], $data['history']);
        $forMode = array_values(array_filter($history, fn ($row) => $row['priceMode'] === $mode));
        usort($forMode, fn ($a, $b) => strcmp($b['updatedAt'], $a['updatedAt']));
        $lastForMode = $forMode[0] ?? null;
        if ($lastForMode && $lastForMode['goldRatePerTola'] == $tola && $lastForMode['goldRatePerGram'] == $gram && $lastForMode['date'] === $today) {
            return ['changed' => false, 'history' => $data['history']];
        }
        if ($lastForMode) {
            $lastT = strtotime($lastForMode['updatedAt']);
            if ($lastT !== false && time() < $lastT + 1) {
                $now = gmdate('Y-m-d\TH:i:s', $lastT + 1) . '.000Z';
            }
        }
        $history[] = ['date' => $today, 'goldRatePerTola' => $tola, 'goldRatePerGram' => $gram, 'priceMode' => $mode, 'updatedAt' => $now];
        $data['history'] = self::trimHistory($history);
        $saved = self::write($data);
        return ['changed' => true, 'history' => $saved['history']];
    }

    public static function getForClient(string $date, string $priceMode): array
    {
        $data = self::read();
        $mode = $priceMode === 'api' ? 'api' : 'manual';
        $day = substr(Pos::str($date) ?: date('Y-m-d'), 0, 10);
        $ticks = array_values(array_filter($data['ticks'], fn ($row) => $row['date'] === $day && $row['priceMode'] === $mode));
        usort($ticks, function ($a, $b) {
            $d = ($a['daySecond'] ?? 0) <=> ($b['daySecond'] ?? 0);
            return $d !== 0 ? $d : strcmp($a['updatedAt'] ?? '', $b['updatedAt'] ?? '');
        });
        $history = array_values(array_filter($data['history'], fn ($row) => $row['priceMode'] === $mode));
        usort($history, fn ($a, $b) => strcmp($b['updatedAt'], $a['updatedAt']));
        return ['ticks' => $ticks, 'history' => $history];
    }

    public static function clear(string $priceMode): array
    {
        $mode = $priceMode === 'api' ? 'api' : 'manual';
        $data = self::read();
        $data['ticks'] = array_values(array_filter($data['ticks'], fn ($row) => $row['priceMode'] !== $mode));
        $data['history'] = array_values(array_filter($data['history'], fn ($row) => $row['priceMode'] !== $mode));
        $saved = self::write($data);
        return ['history' => $saved['history']];
    }

    /** Cron capture: store the live gold rate as history + a tick when it changed. */
    public static function captureIfChanged(array $options = []): array
    {
        if (!MetalRates::isConfigured()) return ['ok' => false, 'skipped' => true, 'reason' => 'api_not_configured'];
        $currency = MetalRates::normalizeMetalCurrency($options['currency'] ?? env('CRON_METAL_CURRENCY', 'USD'));
        $live = MetalRates::getLiveRates($currency);
        $tolaNpr = self::displayToNpr($live['gold']['perTola'] ?? 0, $currency);
        $gramNpr = self::displayToNpr($live['gold']['perGram'] ?? 0, $currency) ?: Pos::round2($tolaNpr / Pos::TOLA_GRAMS);
        if (!$tolaNpr || $tolaNpr <= 0) return ['ok' => false, 'skipped' => true, 'reason' => 'invalid_rate'];
        $localDate = $options['localDate'] ?? self::localDateStr();
        $result = self::appendHistory([
            'goldRatePerTola' => $tolaNpr, 'goldRatePerGram' => $gramNpr,
            'priceMode' => 'api', 'localDate' => $localDate,
        ]);
        self::appendTicks([[
            'date' => self::localDateStr(), 'updatedAt' => Pos::nowIso(),
            'daySecond' => (int) date('G') * 3600 + (int) date('i') * 60 + (int) date('s'),
            'goldRatePerTola' => $tolaNpr, 'goldRatePerGram' => $gramNpr,
            'priceMode' => 'api', 'saved' => $result['changed'],
        ]]);
        return [
            'ok' => true, 'changed' => $result['changed'],
            'goldRatePerTola' => $tolaNpr, 'goldRatePerGram' => $gramNpr,
            'currency' => $currency, 'source' => $live['source'] ?? null,
            'liveUpdatedAt' => $live['updatedAt'] ?? null,
        ];
    }
}
