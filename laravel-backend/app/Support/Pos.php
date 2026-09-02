<?php

namespace App\Support;

/**
 * Shared POS calculation helpers, ported 1:1 from the original Express
 * backend (routes/api.ts). All money math is in NPR and server-authoritative.
 */
class Pos
{
    public const TOLA_GRAMS = 11.664;
    public const AANA_PER_TOLA = 16;
    public const LAAL_PER_AANA = 6.25;
    public const LAAL_PER_TOLA = self::AANA_PER_TOLA * self::LAAL_PER_AANA;

    public const DEFAULT_FX_RATES = ['USD' => 133, 'CAD' => 98];
    public const PAYMENT_METHODS = ['cash', 'esewa', 'khalti', 'card', 'bank', 'credit'];
    public const DEFAULT_ITEM_CATEGORIES = ['Gold', 'Silver', 'Other'];

    /** JS `Number(x) || fallback` semantics (null/''/NaN -> fallback; 0 stays 0 unless fallback given). */
    public static function num($v, float $fallback = 0): float
    {
        if (is_bool($v)) return $v ? 1 : $fallback;
        if ($v === null || $v === '' || !is_numeric($v)) return $fallback;
        $f = (float) $v;
        // "1e400" is numeric but INF, and INF cannot be JSON-encoded — the
        // request would end in a 500 instead of a validation message.
        return is_finite($f) ? $f : $fallback;
    }

    /** The largest amount/weight/quantity a request may carry. */
    public const MAX_AMOUNT = 1e12;

    /**
     * Rejects amounts that cannot be right: negative, non-finite or absurdly
     * large. Fields that are absent or null are skipped (updates send only
     * what changed). Returns the first problem as a message, or null.
     */
    public static function amountError(array $body, array $fields): ?string
    {
        foreach ($fields as $field) {
            if (!array_key_exists($field, $body) || $body[$field] === null || $body[$field] === '') continue;
            $v = $body[$field];
            if (is_bool($v) || !is_numeric($v)) return ucfirst(self::humanField($field)) . ' must be a number.';
            $f = (float) $v;
            if (!is_finite($f) || $f > self::MAX_AMOUNT) return ucfirst(self::humanField($field)) . ' is too large.';
            if ($f < 0) return ucfirst(self::humanField($field)) . ' cannot be negative.';
        }
        return null;
    }

    private static function humanField(string $field): string
    {
        return strtolower(trim(preg_replace('/([A-Z])/', ' $1', $field)));
    }

    /** Strict Number(x): returns null when not finite (like Number.isFinite guard). */
    public static function numOrNull($v): ?float
    {
        if ($v === null) return null;
        if ($v === '') return null;
        if (is_bool($v)) return $v ? 1.0 : 0.0;
        if (is_numeric($v)) { $f = (float) $v; return is_finite($f) ? $f : null; }
        return null;
    }

    public static function str($v): string
    {
        if ($v === null || is_array($v) || is_object($v)) return '';
        if (is_bool($v)) return $v ? 'true' : 'false';
        return trim((string) $v);
    }

    public static function newId(string $prefix): string
    {
        return $prefix . '-' . bin2hex(random_bytes(4));
    }

    /** JS new Date().toISOString() equivalent (UTC, milliseconds). */
    public static function nowIso(): string
    {
        $t = microtime(true);
        $ms = (int) floor(($t - floor($t)) * 1000);
        return gmdate('Y-m-d\TH:i:s', (int) $t) . '.' . str_pad((string) $ms, 3, '0', STR_PAD_LEFT) . 'Z';
    }

    public static function today(): string
    {
        return gmdate('Y-m-d');
    }

    public static function round2(float $v): float
    {
        return round($v, 2);
    }

    public static function gramsToTola(float $grams): float
    {
        return round($grams / self::TOLA_GRAMS, 3);
    }

    public static function fxNprPerUnit(array $settings, $code): float
    {
        $c = strtoupper(self::str($code) ?: 'USD');
        if ($c === 'NPR') return 1;
        $table = array_merge(self::DEFAULT_FX_RATES, (array) ($settings['fxRates'] ?? []));
        $v = self::numOrNull($table[$c] ?? null);
        return ($v !== null && $v > 0) ? $v : self::DEFAULT_FX_RATES['USD'];
    }

    public static function itemMetalType($item): string
    {
        $slug = strtolower(self::str(is_array($item) ? ($item['category'] ?? '') : ''));
        if ($slug === 'silver') return 'silver';
        if ($slug === 'other') return 'other';
        return 'gold';
    }

    public static function resolveJartiWeightGrams(float $weightGrams, $jartiRateType = 'percent', $jartiRateValue = 0): float
    {
        $value = self::num($jartiRateValue);
        if ($value <= 0) return 0;
        $grams = $weightGrams;
        $type = self::str($jartiRateType);
        if ($type === 'grams') return $value;
        if ($type === 'percent') return $grams > 0 ? ($grams * $value) / 100 : 0;
        return 0;
    }

    public static function calcJartiAmount(array $opts): float
    {
        $value = self::num($opts['jartiRateValue'] ?? 0);
        if ($value <= 0) return 0;
        $grams = self::num($opts['weightGrams'] ?? 0);
        $metal = self::num($opts['metalValue'] ?? 0);
        $ratePerTola = self::num($opts['ratePerTola'] ?? 0);
        $karatFactor = self::num($opts['karatFactor'] ?? 1);
        $type = self::str($opts['jartiRateType'] ?? 'flat') ?: 'flat';
        if ($type === 'percent' || $type === 'grams') {
            $jartiGrams = self::resolveJartiWeightGrams($grams, $type, $value);
            if ($jartiGrams <= 0) return 0;
            if ($ratePerTola > 0) return $jartiGrams * ($ratePerTola / self::TOLA_GRAMS) * ($karatFactor ?: 1);
            if ($type === 'percent' && $metal > 0) return ($metal * $value) / 100;
            return 0;
        }
        switch ($type) {
            case 'per_gram': return $grams > 0 ? $value * $grams : 0;
            case 'per_tola': return $grams > 0 ? $value * ($grams / self::TOLA_GRAMS) : 0;
            case 'flat':
            default: return $value;
        }
    }

    /** @param array|float $rates metal rates array (goldRatePerTola / silverRatePerTola) or bare gold rate */
    public static function itemValue(array $item, $rates): int
    {
        $goldRate = is_array($rates) ? self::num($rates['goldRatePerTola'] ?? 0) : self::num($rates);
        $silverRate = is_array($rates) ? self::num($rates['silverRatePerTola'] ?? 0) : 0;
        $weightTola = self::gramsToTola(self::num($item['weightGrams'] ?? 0));
        $making = self::num($item['makingCharge'] ?? 0);
        $metal = self::itemMetalType($item);
        $metalValue = 0.0;
        $rate = 0.0;
        $karatFactor = 1.0;
        if ($metal === 'silver') {
            $rate = $silverRate;
            $metalValue = $weightTola * $silverRate;
        } elseif ($metal === 'other') {
            $rate = self::num($item['customRatePerTola'] ?? 0);
            if (!$rate) {
                $sale = self::num($item['salePrice'] ?? 0);
                if ($sale > 0) return (int) round($sale);
                return (int) round($making);
            }
            $metalValue = $weightTola * $rate;
        } else {
            $rate = $goldRate;
            $karatFactor = (self::num($item['karat'] ?? 0) ?: 24) / 24;
            $metalValue = $weightTola * $goldRate * $karatFactor;
        }
        $jarti = self::calcJartiAmount([
            'jartiRateType' => $item['jartiRateType'] ?? 'flat',
            'jartiRateValue' => $item['jartiRateValue'] ?? 0,
            'weightGrams' => self::num($item['weightGrams'] ?? 0),
            'metalValue' => $metalValue,
            'ratePerTola' => $rate,
            'karatFactor' => $karatFactor,
        ]);
        return (int) round($metalValue + $making + $jarti);
    }

    public static function isItemSoldOut($item): bool
    {
        return is_array($item) && (($item['status'] ?? '') === 'sold_out' || self::num($item['quantity'] ?? 0) <= 0);
    }

    public static function normalizeItemRecord(array $item, bool $isNew = false): array
    {
        $qty = max(0, (int) floor(self::num($item['quantity'] ?? 0)));
        $status = self::str($item['status'] ?? '') ?: 'in_stock';
        if ($status === 'sold_out') { $item['quantity'] = 0; $item['status'] = 'sold_out'; return $item; }
        if ($status === 'in_stock' && $qty === 0) {
            if ($isNew) { $item['quantity'] = 1; $item['status'] = 'in_stock'; }
            else { $item['quantity'] = 0; $item['status'] = 'sold_out'; }
            return $item;
        }
        if ($qty > 0 && $status === 'sold_out') {
            if ($isNew) { $item['quantity'] = $qty; $item['status'] = 'in_stock'; }
            else { $item['quantity'] = 0; $item['status'] = 'sold_out'; }
            return $item;
        }
        $item['quantity'] = $qty;
        $item['status'] = $status;
        return $item;
    }

    public static function validateInventoryMetalFields(array $body): ?string
    {
        $category = strtolower(self::str($body['category'] ?? 'gold') ?: 'gold');
        $metal = self::itemMetalType(['category' => $category]);
        if ($metal === 'other' && !(self::num($body['customRatePerTola'] ?? 0) > 0)) {
            return 'Enter a rate per tola for Other metal items.';
        }
        return null;
    }

    public static function metalRateForItem(array $item, array $metals): float
    {
        $metal = self::itemMetalType($item);
        if ($metal === 'silver') return self::num($metals['silverRatePerTola'] ?? 0);
        if ($metal === 'other') return self::num($item['customRatePerTola'] ?? 0);
        return self::num($metals['goldRatePerTola'] ?? 0);
    }

    public static function metalDefaultName(string $category): string
    {
        $metal = self::itemMetalType(['category' => $category]);
        if ($metal === 'silver') return 'Silver';
        if ($metal === 'other') return 'Other';
        return 'Gold';
    }

    public static function calcItemLinePrice(array $item, array $opts): int
    {
        $weightUnit = $opts['weightUnit'] ?? 'grams';
        $tolaParts = $opts['tolaParts'] ?? null;
        $metals = $opts['metals'];
        $metal = self::itemMetalType($item);
        $making = self::num($item['makingCharge'] ?? 0);
        $weightGrams = self::num($item['weightGrams'] ?? 0);
        $rate = self::metalRateForItem($item, $metals);
        if ($metal === 'other' && !$rate) {
            $sale = self::num($item['salePrice'] ?? 0);
            if ($sale > 0) return (int) round($sale);
            return (int) round($making);
        }
        $karatFactor = $metal === 'gold' ? ((self::num($item['karat'] ?? 0) ?: 24) / 24) : 1;
        $metalValue = 0.0;
        if ($weightUnit === 'tola' && $tolaParts) {
            $t = self::num($tolaParts['tola'] ?? 0);
            $a = self::num($tolaParts['aana'] ?? 0);
            $l = self::num($tolaParts['laal'] ?? 0);
            if (!$t && !$a && !$l) return 0;
            if (!$rate) return 0;
            $rateAana = $rate / self::AANA_PER_TOLA;
            $rateLaal = $rate / self::LAAL_PER_TOLA;
            $metalValue = ($t * $rate + $a * $rateAana + $l * $rateLaal) * $karatFactor;
        } else {
            if (!$weightGrams) return 0;
            return self::itemValue($item, $metals);
        }
        $jarti = self::calcJartiAmount([
            'jartiRateType' => $item['jartiRateType'] ?? 'flat',
            'jartiRateValue' => $item['jartiRateValue'] ?? 0,
            'weightGrams' => $weightGrams,
            'metalValue' => $metalValue,
            'ratePerTola' => $rate,
            'karatFactor' => $karatFactor,
        ]);
        return (int) round($metalValue + $making + $jarti);
    }

    public static function inDateRange($iso, ?string $start, ?string $end): bool
    {
        $day = substr(self::str($iso), 0, 10);
        if (!$day) return false;
        if ($start && strcmp($day, $start) < 0) return false;
        if ($end && strcmp($day, $end) > 0) return false;
        return true;
    }

    public static function customerMatchKey($name, $phone): string
    {
        return strtolower(self::str($name)) . '|' . self::str($phone);
    }

    public static function oldGoldBuyValue(float $weightGrams, float $karat, float $ratePerTola): int
    {
        return (int) round(($weightGrams / self::TOLA_GRAMS) * $ratePerTola * (($karat ?: 24) / 24));
    }

    public static function schemePaidTotal(array $scheme): float
    {
        $sum = 0;
        foreach (($scheme['installments'] ?? []) as $p) $sum += self::num($p['amount'] ?? 0);
        return $sum;
    }

    public static function saleDueRemaining(array $sale): float
    {
        $baseDue = self::num($sale['payment']['due'] ?? 0);
        $paidSince = 0;
        foreach (($sale['payments'] ?? []) as $p) $paidSince += self::num($p['amount'] ?? 0);
        return max(0, $baseDue - $paidSince);
    }

    public static function withDueFields(array $sale): array
    {
        $paidSince = 0;
        foreach (($sale['payments'] ?? []) as $p) $paidSince += self::num($p['amount'] ?? 0);
        $sale['paidSince'] = $paidSince;
        $sale['dueRemaining'] = self::saleDueRemaining($sale);
        return $sale;
    }

    // ── Phone validation (ported from lib/phone.ts) ──────────────────────────

    public const PHONE_REGIONS = ['NP', 'US', 'CA'];

    public static function phoneDigits($phone): string
    {
        return preg_replace('/\D/', '', (string) ($phone ?? ''));
    }

    public static function normalizePhoneRegion($region): string
    {
        $code = strtoupper(self::str($region) ?: 'NP');
        return in_array($code, self::PHONE_REGIONS, true) ? $code : 'NP';
    }

    public static function isValidPhoneForRegion($phone, $region): bool
    {
        $digits = self::phoneDigits($phone);
        if (!$digits) return false;
        $r = self::normalizePhoneRegion($region);
        if ($r === 'NP') return self::isNepaliPhone($digits);
        return self::isNanpPhone($digits);
    }

    public static function isValidPhone($phone, $region = null): bool
    {
        if ($region) return self::isValidPhoneForRegion($phone, $region);
        $digits = self::phoneDigits($phone);
        if (!$digits) return false;
        return self::isNepaliPhone($digits) || self::isNanpPhone($digits);
    }

    private static function isNepaliPhone(string $digits): bool
    {
        $national = preg_replace('/^977/', '', $digits);
        return (bool) preg_match('/^(97|98)\d{8}$/', $national);
    }

    private static function isNanpPhone(string $digits): bool
    {
        $d = preg_replace('/^1/', '', $digits);
        return strlen($d) === 10 && preg_match('/^[2-9]\d{2}[2-9]\d{6}$/', $d);
    }

    public static function phoneErrorMessage($region): string
    {
        $r = self::normalizePhoneRegion($region);
        if ($r === 'NP') return 'Enter a valid Nepal mobile number (97/98XXXXXXXX or +977…).';
        if ($r === 'US') return 'Enter a valid US phone number (10 digits).';
        if ($r === 'CA') return 'Enter a valid Canadian phone number (10 digits).';
        return 'Enter a valid phone number.';
    }

    public static function validateCustomerPhone($phone, $phoneRegion): ?string
    {
        $phone = self::str($phone);
        if (!$phone) return null;
        if ($phoneRegion) {
            return self::isValidPhoneForRegion($phone, $phoneRegion)
                ? null
                : self::phoneErrorMessage(self::normalizePhoneRegion($phoneRegion));
        }
        return self::isValidPhone($phone) ? null : 'Enter a valid phone number for Nepal, US, or Canada.';
    }

    // ── Settings helpers ─────────────────────────────────────────────────────

    public static function defaultSettings(): array
    {
        return [
            'shopName' => 'SubarnaPasal', 'shopAddress' => '', 'shopPhone' => '', 'shopPan' => '',
            'vatRate' => 13, 'calendarMode' => 'both', 'priceMode' => 'manual',
            'country' => null, 'salesTaxRate' => 0,
            'goldRatePerTola' => 0, 'goldRatePerGram' => 0, 'goldBuyRatePerTola' => 0, 'goldBuyRatePerGram' => 0,
            'silverRatePerTola' => 0, 'silverRatePerGram' => 0, 'currency' => 'NPR',
            'locations' => ['Desk A', 'Desk B', 'Side Desk'], 'itemCategories' => ['Gold', 'Silver', 'Other'],
            'rateHistory' => [], 'updatedAt' => self::nowIso(),
            'fxRates' => self::DEFAULT_FX_RATES, 'fxUpdatedAt' => null,
            'invoiceCounter' => 0, 'repairCounter' => 0, 'schemeCounter' => 0, 'dueCounter' => 0,
            'requestCounter' => 0,
        ];
    }

    public static function normalizeItemCategories($list): array
    {
        $items = [];
        foreach ((is_array($list) ? $list : []) as $c) {
            $v = self::str($c);
            if ($v !== '' && !in_array($v, $items, true)) $items[] = $v;
        }
        foreach (['Gold', 'Silver', 'Other'] as $name) {
            $found = false;
            foreach ($items as $c) if (strtolower($c) === strtolower($name)) { $found = true; break; }
            if (!$found) $items[] = $name;
        }
        return $items;
    }

    public static function silverRatePerTolaFromSettings(array $settings): float
    {
        if (($settings['silverRatePerTola'] ?? null) !== null && self::num($settings['silverRatePerTola']) > 0) {
            return self::num($settings['silverRatePerTola']);
        }
        $perGram = self::num($settings['silverRatePerGram'] ?? 0);
        return $perGram > 0 ? self::round2($perGram * self::TOLA_GRAMS) : 0;
    }

    public static function normalizeSilverRates(array $settings): array
    {
        $silverRatePerTola = self::silverRatePerTolaFromSettings($settings);
        $settings['silverRatePerTola'] = $silverRatePerTola;
        $settings['silverRatePerGram'] = self::round2($silverRatePerTola / self::TOLA_GRAMS);
        return $settings;
    }

    public static function normalizeShopName($name): string
    {
        return strtolower(self::str($name));
    }
}
