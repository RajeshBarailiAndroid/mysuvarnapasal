<?php

namespace App\Http\Controllers\Api;

use App\Services\SharedRates;
use App\Support\Pos;
use App\Support\StoreLogic;
use Illuminate\Http\Request;

class SettingsController extends ApiController
{
    public function show(Request $request)
    {
        $store = $this->readStore($request);
        $settings = Pos::normalizeSilverRates($store['settings']);
        if (Pos::num($settings['goldRatePerTola'] ?? 0) > 0 && ($settings['priceMode'] ?? 'manual') !== 'api') {
            SharedRates::appendHistory([
                'goldRatePerTola' => $settings['goldRatePerTola'],
                'goldRatePerGram' => $settings['goldRatePerGram'],
                'priceMode' => 'manual',
            ]);
        }
        $shared = SharedRates::read();
        return response()->json(array_merge($settings, [
            // null (not 'NP') when the shop has never picked a location — the
            // frontend auto-detects the country once and saves it back.
            'country' => $settings['country'] ?? null,
            'salesTaxRate' => Pos::num($settings['salesTaxRate'] ?? 0),
            'locations' => StoreLogic::getStoreLocations($store),
            'itemCategories' => StoreLogic::getStoreItemCategories($store),
            'goldRatePerGram' => Pos::round2(Pos::num($settings['goldRatePerTola'] ?? 0) / Pos::TOLA_GRAMS),
            'goldBuyRatePerGram' => Pos::round2(Pos::num($settings['goldBuyRatePerTola'] ?? 0) / Pos::TOLA_GRAMS),
            'rateHistory' => $shared['history'] ?? [],
        ]));
    }

    public function update(Request $request)
    {
        $store = $this->readStore($request);
        $body = $request->json()->all();
        $now = Pos::nowIso();
        $settings = &$store['settings'];

        if (array_key_exists('goldRatePerTola', $body) && $body['goldRatePerTola'] !== null) {
            $newRate = Pos::numOrNull($body['goldRatePerTola']);
            if ($newRate === null || $newRate < 0) return $this->fail('Gold rate must be a valid number.');
            $settings['goldRatePerTola'] = $newRate;
            SharedRates::appendHistory([
                'goldRatePerTola' => $newRate,
                'goldRatePerGram' => Pos::round2($newRate / Pos::TOLA_GRAMS),
                'priceMode' => 'manual',
            ]);
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
        $settings['goldRatePerGram'] = Pos::round2(Pos::num($settings['goldRatePerTola'] ?? 0) / Pos::TOLA_GRAMS);
        $settings['goldBuyRatePerGram'] = Pos::round2(Pos::num($settings['goldBuyRatePerTola'] ?? 0) / Pos::TOLA_GRAMS);
        $settings = Pos::normalizeSilverRates($settings);
        unset($settings);
        $this->writeStore($request, $store);
        $shared = SharedRates::read();
        return response()->json(array_merge($store['settings'], [
            'locations' => StoreLogic::getStoreLocations($store),
            'itemCategories' => StoreLogic::getStoreItemCategories($store),
            'goldBuyRatePerGram' => Pos::round2(Pos::num($store['settings']['goldBuyRatePerTola'] ?? 0) / Pos::TOLA_GRAMS),
            'rateHistory' => $shared['history'] ?? [],
        ]));
    }

    public function dailyGoldRate(Request $request)
    {
        $body = $request->json()->all();
        $tola = Pos::numOrNull($body['goldRatePerTola'] ?? null);
        if ($tola === null || $tola < 0) return $this->fail('Gold rate must be a valid number.');
        $gram = Pos::num($body['goldRatePerGram'] ?? 0) ?: Pos::round2($tola / Pos::TOLA_GRAMS);
        $priceMode = ($body['priceMode'] ?? '') === 'api' ? 'api' : 'manual';
        $result = SharedRates::appendHistory([
            'goldRatePerTola' => $tola, 'goldRatePerGram' => $gram,
            'priceMode' => $priceMode, 'localDate' => $body['localDate'] ?? null,
        ]);
        $shared = SharedRates::read();
        return response()->json(['changed' => $result['changed'], 'rateHistory' => $shared['history'] ?? []]);
    }

    public function clearRateHistory(Request $request)
    {
        $priceMode = $request->query('priceMode') === 'api' ? 'api' : 'manual';
        $result = SharedRates::clear($priceMode);
        return response()->json(['rateHistory' => $result['history']]);
    }

    public function shopNameAvailable(Request $request)
    {
        $name = Pos::str($request->query('name', ''));
        if ($name === '') return response()->json(['available' => false]);
        $taken = $this->store->isShopNameTaken($name, $this->userId($request));
        return response()->json(['available' => !$taken]);
    }
}
