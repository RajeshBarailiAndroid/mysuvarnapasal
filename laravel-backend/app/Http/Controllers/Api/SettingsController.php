<?php

namespace App\Http\Controllers\Api;

use App\Support\Pos;
use App\Support\StoreLogic;
use Illuminate\Http\Request;

class SettingsController extends ApiController
{
    public function show(Request $request)
    {
        $store = $this->readStore($request);
        $settings = Pos::normalizeSilverRates($store['settings']);
        // A shop's own rate history. It used to be appended to the GLOBAL
        // shared_gold_rates row on every read, which published every shop's
        // private selling rate to every other shop.
        return response()->json(array_merge($settings, [
            // null (not 'NP') when the shop has never picked a location — the
            // frontend auto-detects the country once and saves it back.
            'country' => $settings['country'] ?? null,
            'salesTaxRate' => Pos::num($settings['salesTaxRate'] ?? 0),
            'locations' => StoreLogic::getStoreLocations($store),
            'itemCategories' => StoreLogic::getStoreItemCategories($store),
            'goldRatePerGram' => Pos::round2(Pos::num($settings['goldRatePerTola'] ?? 0) / Pos::TOLA_GRAMS),
            'goldBuyRatePerGram' => Pos::round2(Pos::num($settings['goldBuyRatePerTola'] ?? 0) / Pos::TOLA_GRAMS),
            'rateHistory' => self::historyOf($store),
        ]));
    }

    public function update(Request $request)
    {
        $store = $this->readStore($request);
        $body = $request->json()->all();
        $now = Pos::nowIso();
        $settings = &$store['settings'];

        // Optimistic concurrency for the rate. A client that says which
        // version it last saw (`knownRatesUpdatedAt`) is refused when the
        // server has moved on since — with the current figures in the reply,
        // so it can show them and let the shopkeeper decide. Clients that
        // send nothing keep plain last-write-wins.
        $touchesRate = array_key_exists('goldRatePerTola', $body) || array_key_exists('silverRatePerTola', $body)
            || array_key_exists('goldBuyRatePerTola', $body) || array_key_exists('goldBuyRatePerGram', $body)
            || array_key_exists('silverRatePerGram', $body);
        $known = Pos::str($body['knownRatesUpdatedAt'] ?? '');
        $current = Pos::str($settings['ratesUpdatedAt'] ?? '');
        if ($touchesRate && $known !== '' && $current !== '' && strcmp($current, $known) > 0) {
            return response()->json([
                'error' => 'The rate was changed on another device since you opened it. Check the new value and save again.',
                'conflict' => true,
                'rates' => self::ratesOf($settings),
            ], 409);
        }
        $rateBefore = [$settings['goldRatePerTola'] ?? 0, $settings['silverRatePerTola'] ?? 0, $settings['goldBuyRatePerTola'] ?? 0];

        if (array_key_exists('goldRatePerTola', $body) && $body['goldRatePerTola'] !== null) {
            $newRate = Pos::numOrNull($body['goldRatePerTola']);
            if ($newRate === null || $newRate < 0) return $this->fail('Gold rate must be a valid number.');
            $settings['goldRatePerTola'] = $newRate;
            $settings['rateHistory'] = self::appendOwnHistory(
                $settings['rateHistory'] ?? [],
                $newRate,
                Pos::round2($newRate / Pos::TOLA_GRAMS)
            );
        }
        if (($body['goldBuyRatePerTola'] ?? null) !== null) {
            $buyRate = Pos::numOrNull($body['goldBuyRatePerTola']);
            if ($buyRate === null || $buyRate < 0) return $this->fail('Gold buy rate must be a valid number.');
            $settings['goldBuyRatePerTola'] = $buyRate;
            $settings['goldBuyRatePerGram'] = Pos::round2($buyRate / Pos::TOLA_GRAMS);
        } elseif (($body['goldBuyRatePerGram'] ?? null) !== null) {
            $perGram = Pos::num($body['goldBuyRatePerGram']);
            $settings['goldBuyRatePerGram'] = $perGram;
            $settings['goldBuyRatePerTola'] = Pos::round2($perGram * Pos::TOLA_GRAMS);
        }
        if (($body['shopName'] ?? null) !== null) {
            $name = Pos::str($body['shopName']);
            if ($name === '') return $this->fail('Shop name is required.');
            if (Pos::normalizeShopName($name) !== Pos::normalizeShopName($settings['shopName'] ?? '')) {
                if ($this->store->isShopNameTaken($name, $this->userId($request))) {
                    return $this->fail('This store name is already taken. Please choose another name.', 409);
                }
            }
            $settings['shopName'] = $name;
        }
        if (($body['shopAddress'] ?? null) !== null) $settings['shopAddress'] = Pos::str($body['shopAddress']);
        if (($body['shopPhone'] ?? null) !== null) $settings['shopPhone'] = Pos::str($body['shopPhone']);
        if (($body['shopPan'] ?? null) !== null) $settings['shopPan'] = Pos::str($body['shopPan']);
        if (($body['vatRate'] ?? null) !== null) {
            $rate = Pos::numOrNull($body['vatRate']);
            if ($rate === null || $rate < 0 || $rate > 100) return $this->fail('VAT rate must be between 0 and 100.');
            $settings['vatRate'] = $rate;
        }
        // Shop location (country). Nepal keeps the existing VAT + guarantee-bill
        // behaviour; USA/Canada switch to a custom sales-tax percentage.
        if (($body['country'] ?? null) !== null) {
            $code = strtoupper(Pos::str($body['country']));
            if (!in_array($code, ['NP', 'US', 'CA'], true)) return $this->fail('Shop location must be NP, US or CA.');
            $settings['country'] = $code;
        }
        if (($body['salesTaxRate'] ?? null) !== null) {
            $rate = Pos::numOrNull($body['salesTaxRate']);
            if ($rate === null || $rate < 0 || $rate > 100) return $this->fail('Sales tax rate must be between 0 and 100.');
            $settings['salesTaxRate'] = $rate;
        }
        if (($body['calendarMode'] ?? null) !== null) {
            $mode = strtolower(Pos::str($body['calendarMode']));
            if (in_array($mode, ['both', 'bs', 'ad'], true)) $settings['calendarMode'] = $mode;
        }
        // Live/API pricing is gone — the shop's own rate is the only rate.
        $settings['priceMode'] = 'manual';
        if (($body['fxRates'] ?? null) !== null) {
            $fx = is_array($body['fxRates']) ? $body['fxRates'] : [];
            $updated = array_merge(Pos::DEFAULT_FX_RATES, (array) ($settings['fxRates'] ?? []));
            foreach (['USD', 'CAD'] as $code) {
                if (($fx[$code] ?? null) !== null) {
                    $v = Pos::numOrNull($fx[$code]);
                    if ($v === null || $v <= 0) return $this->fail("FX rate for {$code} must be a positive number (NPR per 1 {$code}).");
                    $updated[$code] = $v;
                }
            }
            $settings['fxRates'] = $updated;
            $settings['fxUpdatedAt'] = $now;
        }
        if (($body['silverRatePerTola'] ?? null) !== null) {
            $settings['silverRatePerTola'] = Pos::num($body['silverRatePerTola']);
        } elseif (($body['silverRatePerGram'] ?? null) !== null) {
            $perGram = Pos::num($body['silverRatePerGram']);
            $settings['silverRatePerGram'] = $perGram;
            $settings['silverRatePerTola'] = Pos::round2($perGram * Pos::TOLA_GRAMS);
        }
        if (($body['currency'] ?? null) !== null) {
            $code = strtoupper(Pos::str($body['currency']));
            if (in_array($code, ['USD', 'CAD', 'NPR'], true)) $settings['currency'] = $code;
        }
        if (($body['locations'] ?? null) !== null) {
            if (!is_array($body['locations'])) return $this->fail('Locations must be an array.');
            $out = [];
            foreach ($body['locations'] as $l) { $v = Pos::str($l); if ($v !== '' && !in_array($v, $out, true)) $out[] = $v; }
            $settings['locations'] = $out;
        }
        if (($body['itemCategories'] ?? null) !== null) {
            if (!is_array($body['itemCategories'])) return $this->fail('Item categories must be an array.');
            $settings['itemCategories'] = Pos::normalizeItemCategories($body['itemCategories']);
        }
        $settings['updatedAt'] = $now;
        $rateAfter = [$settings['goldRatePerTola'] ?? 0, $settings['silverRatePerTola'] ?? 0, $settings['goldBuyRatePerTola'] ?? 0];
        if ($rateAfter != $rateBefore || ($touchesRate && empty($settings['ratesUpdatedAt']))) {
            $settings['ratesUpdatedAt'] = $now;
            $settings['ratesUpdatedBy'] = $request->header('X-SP-Client') === 'mobile' ? 'mobile' : 'web';
        }
        $settings['goldRatePerGram'] = Pos::round2(Pos::num($settings['goldRatePerTola'] ?? 0) / Pos::TOLA_GRAMS);
        $settings['goldBuyRatePerGram'] = Pos::round2(Pos::num($settings['goldBuyRatePerTola'] ?? 0) / Pos::TOLA_GRAMS);
        $settings = Pos::normalizeSilverRates($settings);
        unset($settings);
        $this->writeStore($request, $store);
        return response()->json(array_merge($store['settings'], [
            'locations' => StoreLogic::getStoreLocations($store),
            'itemCategories' => StoreLogic::getStoreItemCategories($store),
            'goldBuyRatePerGram' => Pos::round2(Pos::num($store['settings']['goldBuyRatePerTola'] ?? 0) / Pos::TOLA_GRAMS),
            'rateHistory' => self::historyOf($store),
        ]));
    }

    /**
     * GET /settings/rates — the shop's metal rate and its version stamp, and
     * nothing else. Cheap enough for a phone to call on every foreground and
     * a browser to poll: the whole reply is a few hundred bytes.
     */
    public function rates(Request $request)
    {
        $store = $this->readStore($request);
        return response()->json(self::ratesOf(Pos::normalizeSilverRates($store['settings'])));
    }

    /** The shape every client reads the rate in: per tola, per gram, when, and from where. */
    public static function ratesOf(array $settings): array
    {
        $gold = Pos::num($settings['goldRatePerTola'] ?? 0);
        $silver = Pos::num($settings['silverRatePerTola'] ?? 0);
        $buy = Pos::num($settings['goldBuyRatePerTola'] ?? 0);
        return [
            'goldRatePerTola' => $gold,
            'goldRatePerGram' => Pos::round2($gold / Pos::TOLA_GRAMS),
            'silverRatePerTola' => $silver,
            'silverRatePerGram' => Pos::round2($silver / Pos::TOLA_GRAMS),
            'goldBuyRatePerTola' => $buy,
            'ratesUpdatedAt' => $settings['ratesUpdatedAt'] ?? null,
            'ratesUpdatedBy' => $settings['ratesUpdatedBy'] ?? null,
        ];
    }

    /**
     * The web app's "record today's rate" snapshot. Per shop: it goes into
     * the shop's own settings.rateHistory, never the global row. The
     * `priceMode` and `localDate` the browser used to send are ignored —
     * the server's clock and "manual" are the only honest values here.
     */
    public function dailyGoldRate(Request $request)
    {
        $body = $request->json()->all();
        $tola = Pos::numOrNull($body['goldRatePerTola'] ?? null);
        if ($tola === null || $tola < 0 || !is_finite($tola)) return $this->fail('Gold rate must be a valid number.');
        $gram = Pos::round2($tola / Pos::TOLA_GRAMS);
        $store = $this->readStore($request);
        $before = count($store['settings']['rateHistory'] ?? []);
        $store['settings']['rateHistory'] = self::appendOwnHistory($store['settings']['rateHistory'] ?? [], $tola, $gram);
        $changed = count($store['settings']['rateHistory']) !== $before;
        if ($changed) $this->writeStore($request, $store);
        return response()->json(['changed' => $changed, 'rateHistory' => self::historyOf($store)]);
    }

    /** Clears THIS shop's rate history only. */
    public function clearRateHistory(Request $request)
    {
        $store = $this->readStore($request);
        $store['settings']['rateHistory'] = [];
        $this->writeStore($request, $store);
        return response()->json(['rateHistory' => []]);
    }

    // ── per-shop rate history ───────────────────────────────────────────

    private const MAX_OWN_HISTORY = 2000;

    /** Newest first, in the shape the web chart already understands. */
    private static function historyOf(array $store): array
    {
        $rows = array_values(array_filter((array) ($store['settings']['rateHistory'] ?? []), 'is_array'));
        $rows = array_map(fn ($r) => [
            'date' => substr(Pos::str($r['date'] ?? '') ?: substr((string) ($r['updatedAt'] ?? ''), 0, 10), 0, 10),
            'updatedAt' => (string) ($r['updatedAt'] ?? ''),
            'goldRatePerTola' => Pos::num($r['goldRatePerTola'] ?? 0),
            'goldRatePerGram' => Pos::num($r['goldRatePerGram'] ?? 0),
            'priceMode' => 'manual',
        ], $rows);
        usort($rows, fn ($a, $b) => strcmp($b['updatedAt'], $a['updatedAt']));
        return $rows;
    }

    /**
     * Appends a reading unless it repeats the newest one for the same day.
     * One second is added when two saves land inside the same second, so
     * the chart never receives two points with the same timestamp.
     */
    private static function appendOwnHistory(array $history, float $tola, float $gram): array
    {
        if ($tola <= 0) return $history;
        $history = array_values(array_filter($history, 'is_array'));
        usort($history, fn ($a, $b) => strcmp((string) ($b['updatedAt'] ?? ''), (string) ($a['updatedAt'] ?? '')));
        $last = $history[0] ?? null;
        $now = Pos::nowIso();
        $today = substr($now, 0, 10);
        if ($last
            && Pos::num($last['goldRatePerTola'] ?? 0) == $tola
            && substr((string) ($last['date'] ?? ''), 0, 10) === $today) {
            return $history;
        }
        if ($last && strtotime((string) ($last['updatedAt'] ?? '')) >= time()) {
            $now = gmdate('Y-m-d\TH:i:s', strtotime($last['updatedAt']) + 1) . '.000Z';
        }
        array_unshift($history, [
            'date' => $today, 'updatedAt' => $now,
            'goldRatePerTola' => $tola, 'goldRatePerGram' => $gram, 'priceMode' => 'manual',
        ]);
        return array_slice($history, 0, self::MAX_OWN_HISTORY);
    }

    public function shopNameAvailable(Request $request)
    {
        $name = Pos::str($request->query('name', ''));
        if ($name === '') return response()->json(['available' => false]);
        $taken = $this->store->isShopNameTaken($name, $this->userId($request));
        return response()->json(['available' => !$taken]);
    }
}
