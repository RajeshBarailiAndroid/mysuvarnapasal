<?php

namespace App\Support;

use App\Services\MetalRates;

/**
 * Store-level business logic ported from routes/api.ts. All functions take
 * the in-memory store array (by reference where they mutate it).
 */
class StoreLogic
{
    public static function getStoreLocations(array $store): array
    {
        $locations = $store['settings']['locations'] ?? null;
        if (is_array($locations) && count($locations)) {
            $out = [];
            foreach ($locations as $l) { $v = Pos::str($l); if ($v !== '') $out[] = $v; }
            if ($out) return $out;
        }
        $fromItems = [];
        foreach ($store['items'] as $i) {
            $loc = $i['location'] ?? '';
            if ($loc !== '' && !in_array($loc, $fromItems, true)) $fromItems[] = $loc;
        }
        if ($fromItems) return $fromItems;
        return ['Desk A', 'Desk B', 'Side Desk'];
    }

    public static function getStoreItemCategories(array $store): array
    {
        $cats = $store['settings']['itemCategories'] ?? null;
        if (is_array($cats) && count($cats)) return Pos::normalizeItemCategories($cats);
        return Pos::DEFAULT_ITEM_CATEGORIES;
    }

    public static function parseCustomerNameFromSaleNote($note): string
    {
        $text = (string) ($note ?? '');
        if (preg_match('/^POS — ([^·]+)/u', $text, $m)) return trim($m[1]);
        return '';
    }

    public static function computeCustomerPurchaseCounts(array $store): array
    {
        $counts = [];
        foreach (($store['orders'] ?? []) as $order) {
            if (($order['status'] ?? '') !== 'completed' || empty($order['customerName'])) continue;
            $key = Pos::customerMatchKey($order['customerName'], $order['customerPhone'] ?? '');
            $counts[$key] = ($counts[$key] ?? 0) + 1;
        }
        foreach (($store['transactions'] ?? []) as $tx) {
            if (($tx['type'] ?? '') !== 'sale') continue;
            $name = self::parseCustomerNameFromSaleNote($tx['note'] ?? '');
            if ($name === '') continue;
            $key = Pos::customerMatchKey($name, '');
            $counts[$key] = ($counts[$key] ?? 0) + 1;
        }
        return $counts;
    }

    public static function syncCustomersFromOrders(array &$store): bool
    {
        $customers = $store['customers'] ?? [];
        $byKey = [];
        foreach ($customers as $c) $byKey[Pos::customerMatchKey($c['name'] ?? '', $c['phone'] ?? '')] = true;
        $changed = false;
        foreach (($store['orders'] ?? []) as $order) {
            $name = Pos::str($order['customerName'] ?? '');
            if ($name === '') continue;
            $phone = Pos::str($order['customerPhone'] ?? '');
            $key = Pos::customerMatchKey($name, $phone);
            if (isset($byKey[$key])) continue;
            $customers[] = [
                'id' => Pos::newId('c'), 'name' => $name, 'phone' => $phone,
                'email' => '', 'address' => '',
                'createdAt' => $order['createdAt'] ?? Pos::nowIso(), 'purchases' => 0,
            ];
            $byKey[$key] = true;
            $changed = true;
        }
        if ($changed) $store['customers'] = $customers;
        return $changed;
    }

    public static function listCustomersWithActivity(array &$store): array
    {
        self::syncCustomersFromOrders($store);
        $purchaseCounts = self::computeCustomerPurchaseCounts($store);
        $list = [];
        foreach (($store['customers'] ?? []) as $customer) {
            $customer['purchases'] = $purchaseCounts[Pos::customerMatchKey($customer['name'] ?? '', $customer['phone'] ?? '')] ?? 0;
            $list[] = $customer;
        }
        usort($list, function ($a, $b) {
            $d = ($b['purchases'] ?? 0) <=> ($a['purchases'] ?? 0);
            return $d !== 0 ? $d : strcmp($a['name'] ?? '', $b['name'] ?? '');
        });
        return $list;
    }

    public static function upsertCustomerInStore(array &$store, array $payload): ?array
    {
        $name = Pos::str($payload['name'] ?? '');
        if ($name === '') return null;
        $phone = Pos::str($payload['phone'] ?? '');
        $email = Pos::str($payload['email'] ?? '');
        $address = Pos::str($payload['address'] ?? '');
        $customers = $store['customers'] ?? [];
        $key = Pos::customerMatchKey($name, $phone);
        $foundIdx = null;
        foreach ($customers as $i => $c) {
            if (Pos::customerMatchKey($c['name'] ?? '', $c['phone'] ?? '') === $key) { $foundIdx = $i; break; }
        }
        if ($foundIdx !== null) {
            if ($phone !== '' && empty($customers[$foundIdx]['phone'])) $customers[$foundIdx]['phone'] = $phone;
            if ($email !== '' && empty($customers[$foundIdx]['email'])) $customers[$foundIdx]['email'] = $email;
            if ($address !== '' && empty($customers[$foundIdx]['address'])) $customers[$foundIdx]['address'] = $address;
            $customer = $customers[$foundIdx];
        } else {
            $customer = [
                'id' => Pos::newId('c'), 'name' => $name, 'phone' => $phone,
                'email' => $email, 'address' => $address,
                'createdAt' => Pos::nowIso(), 'purchases' => 0,
            ];
            array_unshift($customers, $customer);
        }
        $store['customers'] = $customers;
        return $customer;
    }

    public static function buildOrderLine(array $item, $quantity, array $metals): array
    {
        $qty = max(1, Pos::num($quantity, 1));
        $unitPrice = Pos::itemValue($item, $metals);
        $jartiWeightGrams = Pos::resolveJartiWeightGrams(
            Pos::num($item['weightGrams'] ?? 0),
            $item['jartiRateType'] ?? 'percent',
            Pos::num($item['jartiRateValue'] ?? 0)
        );
        return [
            'itemId' => $item['id'], 'itemName' => $item['name'], 'sku' => $item['sku'],
            'category' => $item['category'] ?? 'gold',
            'quantity' => $qty, 'unitPrice' => $unitPrice, 'lineTotal' => $unitPrice * $qty,
            'weightGrams' => Pos::num($item['weightGrams'] ?? 0), 'karat' => Pos::num($item['karat'] ?? 0) ?: 24,
            'jartiRateType' => $item['jartiRateType'] ?? 'flat', 'jartiRateValue' => Pos::num($item['jartiRateValue'] ?? 0),
            'jartiWeightGrams' => $jartiWeightGrams,
        ];
    }

    public static function buildCustomOrderLine(array $body, $quantity, array $metals): array
    {
        $custom = is_array($body['customItem'] ?? null) ? $body['customItem'] : [];
        $category = strtolower(Pos::str($custom['category'] ?? $body['customCategory'] ?? $body['category'] ?? 'gold') ?: 'gold');
        $metal = Pos::itemMetalType(['category' => $category]);
        $itemName = Pos::str($custom['name'] ?? $body['customItemName'] ?? '');
        if ($metal === 'other' && $itemName === '') throw new \RuntimeException('Enter a name for Other metal items.');
        $weightGrams = Pos::num($custom['weightGrams'] ?? $body['customWeightGrams'] ?? 0);
        $karat = Pos::num($custom['karat'] ?? $body['customKarat'] ?? 0) ?: 24;
        $makingCharge = Pos::num($custom['makingCharge'] ?? $body['customMakingCharge'] ?? 0);
        $customRatePerTola = Pos::num($custom['customRatePerTola'] ?? $body['customRatePerTola'] ?? 0);
        $jartiRateType = Pos::str($custom['jartiRateType'] ?? $body['customJartiRateType'] ?? 'percent') ?: 'percent';
        $jartiRateValue = Pos::num($custom['jartiRateValue'] ?? $body['customJartiRateValue'] ?? 0);
        $jartiWeightGrams = Pos::num($custom['jartiWeightGrams'] ?? 0);
        if (!$jartiWeightGrams && $jartiRateType !== 'percent') {
            $jt = Pos::num($custom['jartiTola'] ?? $body['customJartiTola'] ?? 0);
            $ja = Pos::num($custom['jartiAana'] ?? $body['customJartiAana'] ?? 0);
            $jl = Pos::num($custom['jartiLaal'] ?? $body['customJartiLaal'] ?? 0);
            if ($jt || $ja || $jl) {
                $totalLaal = $jt * Pos::LAAL_PER_TOLA + $ja * Pos::LAAL_PER_AANA + $jl;
                $jartiWeightGrams = ($totalLaal * Pos::TOLA_GRAMS) / Pos::LAAL_PER_TOLA;
            } else {
                $jartiWeightGrams = Pos::num($custom['jartiGrams'] ?? $body['customJartiGrams'] ?? 0) ?: $jartiRateValue;
            }
        }
        if (!$jartiWeightGrams) $jartiWeightGrams = Pos::resolveJartiWeightGrams($weightGrams, $jartiRateType, $jartiRateValue);
        if ($jartiRateType !== 'percent' && $jartiWeightGrams > 0) $jartiRateValue = $jartiWeightGrams;
        $weightUnit = Pos::str($custom['weightUnit'] ?? $body['customWeightUnit'] ?? 'grams') ?: 'grams';
        $tolaParts = $weightUnit === 'tola' ? [
            'tola' => Pos::num($custom['weightTola'] ?? $body['customWeightTola'] ?? 0),
            'aana' => Pos::num($custom['weightAana'] ?? $body['customWeightAana'] ?? 0),
            'laal' => Pos::num($custom['weightLaal'] ?? $body['customWeightLaal'] ?? 0),
        ] : null;
        $hasTolaWeight = $weightUnit === 'tola' && $tolaParts && ($tolaParts['tola'] || $tolaParts['aana'] || $tolaParts['laal']);
        if ($weightUnit === 'tola') {
            if (!$hasTolaWeight) throw new \RuntimeException('Weight is required.');
        } elseif ($weightGrams <= 0) {
            throw new \RuntimeException('Weight is required.');
        }
        if ($metal === 'other' && !$customRatePerTola) throw new \RuntimeException('Enter a rate per tola for Other metal items.');
        $qty = max(1, Pos::num($quantity, 1));
        $draft = [
            'category' => $category, 'karat' => $karat, 'weightGrams' => $weightGrams,
            'makingCharge' => $makingCharge, 'customRatePerTola' => $customRatePerTola,
            'salePrice' => 0, 'jartiRateType' => $jartiRateType, 'jartiRateValue' => $jartiRateValue,
        ];
        $unitPrice = Pos::calcItemLinePrice($draft, ['weightUnit' => $weightUnit, 'tolaParts' => $tolaParts, 'metals' => $metals]);
        return [
            'itemId' => 'custom-' . (int) (microtime(true) * 1000),
            'itemName' => $itemName !== '' ? $itemName : Pos::metalDefaultName($category),
            'sku' => 'CUSTOM', 'category' => $category, 'quantity' => $qty,
            'unitPrice' => $unitPrice, 'lineTotal' => $unitPrice * $qty, 'custom' => true,
            'weightGrams' => $weightGrams, 'karat' => $karat,
            'customRatePerTola' => $metal === 'other' ? $customRatePerTola : 0,
            'jartiRateType' => $jartiRateType, 'jartiRateValue' => $jartiRateValue,
            'jartiWeightGrams' => $jartiWeightGrams,
        ];
    }

    public static function nextOrderNumber(array $store): string
    {
        $nums = [];
        foreach (($store['orders'] ?? []) as $o) {
            $n = preg_replace('/\D/', '', (string) ($o['orderNumber'] ?? ''));
            if ($n !== '') $nums[] = (int) $n;
        }
        $next = ($nums ? max($nums) : 1000) + 1;
        return "SP-{$next}";
    }

    public static function applyOrderCompletion(array &$store, array $order): void
    {
        foreach (($order['lines'] ?? []) as $line) {
            $idx = null;
            foreach ($store['items'] as $i => $item) if (($item['id'] ?? null) === ($line['itemId'] ?? null)) { $idx = $i; break; }
            if ($idx === null) continue;
            $item = &$store['items'][$idx];
            if (($item['quantity'] ?? 0) < ($line['quantity'] ?? 0)) {
                throw new \RuntimeException("Not enough stock for {$item['name']}.");
            }
            $item['quantity'] -= $line['quantity'];
            if ($item['quantity'] == 0) $item['status'] = 'sold_out';
            $item['updatedAt'] = Pos::nowIso();
            array_unshift($store['transactions'], [
                'id' => Pos::newId('tx'), 'type' => 'sale', 'itemId' => $item['id'], 'itemName' => $item['name'],
                'quantity' => $line['quantity'], 'amount' => $line['lineTotal'] ?? 0,
                'note' => "Order {$order['orderNumber']} — {$order['customerName']}",
                'createdAt' => Pos::nowIso(),
            ]);
            unset($item);
        }
    }

    public static function revertOrderCompletion(array &$store, array $order): void
    {
        $orderRef = "Order {$order['orderNumber']}";
        foreach (($order['lines'] ?? []) as $line) {
            foreach ($store['items'] as $i => $item) {
                if (($item['id'] ?? null) !== ($line['itemId'] ?? null)) continue;
                $store['items'][$i]['quantity'] += $line['quantity'];
                if ($store['items'][$i]['quantity'] > 0) $store['items'][$i]['status'] = 'in_stock';
                $store['items'][$i]['updatedAt'] = Pos::nowIso();
                break;
            }
        }
        $store['transactions'] = array_values(array_filter(
            $store['transactions'],
            fn ($tx) => !(($tx['type'] ?? '') === 'sale' && str_contains((string) ($tx['note'] ?? ''), $orderRef))
        ));
    }

    public static function txAmount(array $store, array $tx): float
    {
        if (($tx['amount'] ?? null) !== null && Pos::numOrNull($tx['amount']) !== null) return (float) $tx['amount'];
        foreach ($store['items'] as $item) {
            if (($item['id'] ?? null) === ($tx['itemId'] ?? null)) {
                return Pos::itemValue($item, $store['settings']) * Pos::num($tx['quantity'] ?? 0);
            }
        }
        return 0;
    }

    // ── counters ─────────────────────────────────────────────────────────────

    public static function nextInvoiceNumber(array &$store): string
    {
        $n = (int) Pos::num($store['settings']['invoiceCounter'] ?? 0) + 1;
        $store['settings']['invoiceCounter'] = $n;
        return 'INV-' . str_pad((string) $n, 6, '0', STR_PAD_LEFT);
    }

    public static function nextRepairNumber(array &$store): string
    {
        $n = (int) Pos::num($store['settings']['repairCounter'] ?? 0) + 1;
        $store['settings']['repairCounter'] = $n;
        return 'REP-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
    }

    public static function nextRequestNumber(array &$store): string
    {
        $n = (int) Pos::num($store['settings']['requestCounter'] ?? 0) + 1;
        $store['settings']['requestCounter'] = $n;
        return 'REQ-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
    }

    public static function nextSchemeNumber(array &$store): string
    {
        $n = (int) Pos::num($store['settings']['schemeCounter'] ?? 0) + 1;
        $store['settings']['schemeCounter'] = $n;
        return 'GS-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
    }

    // ── reports ──────────────────────────────────────────────────────────────

    public static function buildReports(array $store, ?string $start, ?string $end): array
    {
        $metals = MetalRates::resolve($store);
        $inStock = array_values(array_filter($store['items'], fn ($i) => ($i['status'] ?? '') === 'in_stock' && ($i['quantity'] ?? 0) > 0));
        $totalWeight = 0;
        $totalValue = 0;
        foreach ($inStock as $i) {
            $totalWeight += Pos::num($i['weightGrams'] ?? 0) * $i['quantity'];
            $totalValue += Pos::itemValue($i, $metals) * $i['quantity'];
        }
        $lowStock = array_values(array_filter($store['items'], fn ($i) => ($i['status'] ?? '') === 'in_stock' && ($i['quantity'] ?? 0) <= 1));
        $transactions = [];
        foreach ($store['transactions'] as $tx) {
            if (!Pos::inDateRange($tx['createdAt'] ?? '', $start, $end)) continue;
            $tx['amount'] = self::txAmount($store, $tx);
            $transactions[] = $tx;
        }
        usort($transactions, fn ($a, $b) => strcmp($b['createdAt'] ?? '', $a['createdAt'] ?? ''));
        $orders = array_values(array_filter($store['orders'] ?? [], fn ($o) => Pos::inDateRange($o['createdAt'] ?? '', $start, $end)));
        usort($orders, fn ($a, $b) => strcmp($b['createdAt'] ?? '', $a['createdAt'] ?? ''));
        $saleTx = array_values(array_filter($transactions, fn ($tx) => ($tx['type'] ?? '') === 'sale' && !str_contains((string) ($tx['note'] ?? ''), '[VOIDED]')));
        $salesRevenue = array_sum(array_map(fn ($tx) => $tx['amount'], $saleTx));
        $completedOrders = array_values(array_filter($orders, fn ($o) => ($o['status'] ?? '') === 'completed'));
        $orderRevenue = array_sum(array_map(fn ($o) => Pos::num($o['totalAmount'] ?? 0), $completedOrders));
        $pendingOrders = count(array_filter($orders, fn ($o) => in_array($o['status'] ?? '', ['pending', 'confirmed', 'progress', 'ready'], true)));
        $salesByDay = [];
        foreach ($saleTx as $tx) {
            $day = substr($tx['createdAt'] ?? '', 0, 10);
            $salesByDay[$day] = ($salesByDay[$day] ?? 0) + $tx['amount'];
        }
        ksort($salesByDay);
        $customerOrderTotals = [];
        foreach ($orders as $order) {
            $key = ($order['customerName'] ?? '') !== '' ? $order['customerName'] : 'Unknown';
            if (!isset($customerOrderTotals[$key])) {
                $customerOrderTotals[$key] = ['name' => $key, 'phone' => $order['customerPhone'] ?? '', 'orders' => 0, 'total' => 0];
            }
            $customerOrderTotals[$key]['orders'] += 1;
            if (($order['status'] ?? '') === 'completed') $customerOrderTotals[$key]['total'] += Pos::num($order['totalAmount'] ?? 0);
        }
        $topCustomers = array_values($customerOrderTotals);
        usort($topCustomers, fn ($a, $b) => $b['total'] <=> $a['total']);
        $topCustomers = array_slice($topCustomers, 0, 10);
        $categoryCounts = [];
        $totalItems = 0;
        foreach ($inStock as $i) {
            $categoryCounts[$i['category']] = ($categoryCounts[$i['category']] ?? 0) + $i['quantity'];
            $totalItems += $i['quantity'];
        }
        return [
            'period' => ['start' => $start, 'end' => $end],
            'goldRatePerTola' => $metals['goldRatePerTola'],
            'goldRatePerTolaNpr' => $metals['goldRatePerTola'],
            'metalRatesLive' => $metals['live'], 'metalCurrency' => $metals['currency'],
            'currency' => $store['settings']['currency'] ?? 'NPR',
            'sales' => [
                'revenue' => $salesRevenue, 'salesCount' => count($saleTx),
                'orderRevenue' => $orderRevenue, 'completedOrders' => count($completedOrders),
                'pendingOrders' => $pendingOrders, 'totalOrders' => count($orders),
                'salesByDay' => array_map(fn ($date, $amount) => ['date' => $date, 'amount' => $amount], array_keys($salesByDay), array_values($salesByDay)),
                'transactions' => $saleTx,
            ],
            'inventory' => [
                'totalItems' => $totalItems, 'uniqueSkus' => count($inStock),
                'totalWeightGrams' => Pos::round2($totalWeight), 'totalWeightTola' => Pos::gramsToTola($totalWeight),
                'totalInventoryValue' => $totalValue, 'lowStockCount' => count($lowStock),
                'lowStock' => $lowStock, 'categoryCounts' => $categoryCounts ?: new \stdClass(),
                'movements' => $transactions,
            ],
            'customers' => [
                'totalCustomers' => count($topCustomers),
                'activeBuyers' => count(array_filter($topCustomers, fn ($c) => $c['total'] > 0)),
                'topCustomers' => $topCustomers, 'recentOrders' => array_slice($orders, 0, 10),
            ],
        ];
    }
}
