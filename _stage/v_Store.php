<?php

namespace App\Services;

use App\Support\ItemPhoto;
use App\Support\Pos;
use Illuminate\Support\Facades\DB;

/**
 * Per-user data store backed by MySQL. Mirrors the shape the original
 * Express backend used (lib/store.ts): a single associative array with
 * settings, items, transactions, orders, customers plus the JSON
 * collections (karigars, goldLedger, oldGoldExchanges, options, sales,
 * repairs, schemes). Controllers read the store, mutate it in memory and
 * write it back inside one DB transaction — keeping checkout atomic.
 */
class Store
{
    public const LOCAL_DEV_USER_ID = 'local-dev';

    /** collection key => table for generic (user_id, id, data) JSON tables */
    public const JSON_COLLECTIONS = [
        'karigars' => 'karigars',
        'goldLedger' => 'gold_ledger',
        'oldGoldExchanges' => 'old_gold_exchanges',
        'options' => 'options',
        'sales' => 'sales',
        'repairs' => 'repairs',
        'schemes' => 'schemes',
        'requests' => 'requests',
    ];

    public function read(string $userId): array
    {
        $store = [
            'settings' => $this->readSettings($userId),
            'items' => $this->readItems($userId),
            'transactions' => $this->readTransactions($userId),
            'orders' => $this->readOrders($userId),
            'customers' => $this->readCustomers($userId),
        ];
        foreach (self::JSON_COLLECTIONS as $key => $table) {
            $rows = DB::table($table)->where('user_id', $userId)->orderByDesc('position')->get();
            $store[$key] = $rows->map(fn ($r) => json_decode($r->data, true))->filter()->values()->all();
        }
        return $store;
    }

    public function write(string $userId, array $store): void
    {
        DB::transaction(function () use ($userId, $store) {
            $this->writeSettings($userId, $store['settings'] ?? Pos::defaultSettings());
            $this->syncTable($userId, 'items', $store['items'] ?? [], fn ($i) => $this->itemToRow($i, $userId));
            $this->syncTable($userId, 'transactions', $store['transactions'] ?? [], fn ($t) => $this->transactionToRow($t, $userId));
            $this->syncTable($userId, 'orders', $store['orders'] ?? [], fn ($o) => $this->orderToRow($o, $userId));
            $this->syncTable($userId, 'customers', $store['customers'] ?? [], fn ($c) => $this->customerToRow($c, $userId));
            foreach (self::JSON_COLLECTIONS as $key => $table) {
                $this->syncJsonCollection($userId, $table, $store[$key] ?? []);
            }
        });
    }

    // ── settings ─────────────────────────────────────────────────────────────

    private function readSettings(string $userId): array
    {
        $row = DB::table('settings')->where('user_id', $userId)->first();
        if (!$row) return Pos::defaultSettings();
        $extras = json_decode($row->extras ?? 'null', true) ?: [];
        return [
            'shopName' => $row->shop_name,
            'shopAddress' => $row->shop_address ?? '',
            'shopPhone' => $row->shop_phone ?? '',
            'shopPan' => $row->shop_pan ?? '',
            'vatRate' => $row->vat_rate !== null ? (float) $row->vat_rate : 13,
            'calendarMode' => $row->calendar_mode ?: 'both',
            'priceMode' => $row->price_mode ?: 'manual',
            'goldRatePerTola' => (float) $row->gold_rate_per_tola,
            'goldRatePerGram' => (float) $row->gold_rate_per_gram,
            'goldBuyRatePerTola' => (float) $row->gold_buy_rate_per_tola,
            'goldBuyRatePerGram' => (float) $row->gold_buy_rate_per_gram,
            'silverRatePerTola' => (float) $row->silver_rate_per_tola,
            'silverRatePerGram' => (float) $row->silver_rate_per_gram,
            'currency' => $row->currency ?: 'NPR',
            // Shop location + its sales-tax %. There are no columns for these,
            // so they ride along in `extras` — without this the location the
            // shop picks (Nepal / USA / Canada) was silently dropped on save.
            'country' => $extras['country'] ?? null,
            'salesTaxRate' => Pos::num($extras['salesTaxRate'] ?? 0),
            'locations' => json_decode($row->locations ?? '[]', true) ?: [],
            'itemCategories' => json_decode($row->item_categories ?? '[]', true) ?: [],
            'rateHistory' => json_decode($row->rate_history ?? '[]', true) ?: [],
            'updatedAt' => $row->updated_at,
            'fxRates' => $extras['fxRates'] ?? Pos::DEFAULT_FX_RATES,
            'fxUpdatedAt' => $extras['fxUpdatedAt'] ?? null,
            'invoiceCounter' => (int) Pos::num($extras['invoiceCounter'] ?? 0),
            'repairCounter' => (int) Pos::num($extras['repairCounter'] ?? 0),
            'schemeCounter' => (int) Pos::num($extras['schemeCounter'] ?? 0),
            'dueCounter' => (int) Pos::num($extras['dueCounter'] ?? 0),
            'requestCounter' => (int) Pos::num($extras['requestCounter'] ?? 0),
        ];
    }

    private function writeSettings(string $userId, array $s): void
    {
        DB::table('settings')->updateOrInsert(['user_id' => $userId], [
            'shop_name' => $s['shopName'] ?? 'SubarnaPasal',
            'shop_address' => $s['shopAddress'] ?? '',
            'shop_phone' => $s['shopPhone'] ?? '',
            'shop_pan' => $s['shopPan'] ?? '',
            'vat_rate' => $s['vatRate'] ?? 13,
            'calendar_mode' => $s['calendarMode'] ?? 'both',
            'price_mode' => $s['priceMode'] ?? 'manual',
            'gold_rate_per_tola' => $s['goldRatePerTola'] ?? 0,
            'gold_rate_per_gram' => $s['goldRatePerGram'] ?? 0,
            'gold_buy_rate_per_tola' => $s['goldBuyRatePerTola'] ?? 0,
            'gold_buy_rate_per_gram' => $s['goldBuyRatePerGram'] ?? 0,
            'silver_rate_per_tola' => $s['silverRatePerTola'] ?? 0,
            'silver_rate_per_gram' => $s['silverRatePerGram'] ?? 0,
            'currency' => $s['currency'] ?? 'NPR',
            'locations' => json_encode($s['locations'] ?? []),
            'item_categories' => json_encode($s['itemCategories'] ?? []),
            'rate_history' => json_encode($s['rateHistory'] ?? []),
            'extras' => json_encode([
                'country' => $s['country'] ?? null,
                'salesTaxRate' => Pos::num($s['salesTaxRate'] ?? 0),
                'fxRates' => $s['fxRates'] ?? Pos::DEFAULT_FX_RATES,
                'fxUpdatedAt' => $s['fxUpdatedAt'] ?? null,
                'invoiceCounter' => (int) Pos::num($s['invoiceCounter'] ?? 0),
                'repairCounter' => (int) Pos::num($s['repairCounter'] ?? 0),
                'schemeCounter' => (int) Pos::num($s['schemeCounter'] ?? 0),
                'dueCounter' => (int) Pos::num($s['dueCounter'] ?? 0),
                'requestCounter' => (int) Pos::num($s['requestCounter'] ?? 0),
            ]),
            'updated_at' => $s['updatedAt'] ?? Pos::nowIso(),
        ]);
    }

    public function ensureUserSettings(string $userId): void
    {
        if (!DB::table('settings')->where('user_id', $userId)->exists()) {
            $this->writeSettings($userId, Pos::defaultSettings());
        }
    }

    public function isShopNameTaken(string $shopName, string $excludeUserId): bool
    {
        $normalized = Pos::normalizeShopName($shopName);
        if ($normalized === '') return false;
        return DB::table('settings')
            ->where('user_id', '!=', $excludeUserId)
            ->whereRaw('LOWER(shop_name) = ?', [$normalized])
            ->exists();
    }

    // ── items ────────────────────────────────────────────────────────────────

    private function readItems(string $userId): array
    {
        return DB::table('items')->where('user_id', $userId)->orderByDesc('position')->get()
            ->map(fn ($r) => [
                'id' => $r->id, 'sku' => $r->sku, 'name' => $r->name, 'category' => $r->category,
                'itemNumber' => $r->item_number ?? '',
                'photoPath' => $r->photo_path ?: null,
                // Derived on read, never stored — itemToRow drops it again.
                'photoUrl' => ItemPhoto::url($r->photo_path ?: null),
                'karat' => (float) $r->karat, 'weightGrams' => (float) $r->weight_grams,
                'weightUnit' => $r->weight_unit ?? 'grams',
                'makingCharge' => (float) $r->making_charge,
                'jartiRateType' => $r->jarti_rate_type ?: 'flat',
                'jartiRateValue' => (float) $r->jarti_rate_value,
                'hallmarkNumber' => $r->hallmark_number ?? '', 'hallmarkDate' => $r->hallmark_date ?? '',
                'purchaseCost' => (float) $r->purchase_cost, 'salePrice' => (float) $r->sale_price,
                'customRatePerTola' => (float) $r->custom_rate_per_tola,
                'quantity' => (int) $r->quantity, 'status' => $r->status,
                'location' => $r->location ?? '', 'hallmark' => (bool) $r->hallmark,
                'notes' => $r->notes ?? '',
                'hsCode' => $r->hs_code ?? '', 'stoneAmount' => (float) $r->stone_amount,
                'createdAt' => $r->created_at, 'updatedAt' => $r->updated_at,
            ])->all();
    }

    private function itemToRow(array $i, string $userId): array
    {
        return [
            'id' => $i['id'], 'user_id' => $userId, 'sku' => $i['sku'], 'name' => $i['name'],
            'item_number' => $i['itemNumber'] ?? '',
            'photo_path' => $i['photoPath'] ?? null,
            'category' => $i['category'], 'karat' => $i['karat'],
            'weight_grams' => $i['weightGrams'], 'weight_unit' => $i['weightUnit'] ?? 'grams',
            'making_charge' => $i['makingCharge'] ?? 0,
            'jarti_rate_type' => $i['jartiRateType'] ?? 'flat',
            'jarti_rate_value' => $i['jartiRateValue'] ?? 0,
            'hallmark_number' => $i['hallmarkNumber'] ?? '', 'hallmark_date' => $i['hallmarkDate'] ?? '',
            'purchase_cost' => $i['purchaseCost'] ?? 0, 'sale_price' => $i['salePrice'] ?? 0,
            'custom_rate_per_tola' => $i['customRatePerTola'] ?? 0,
            'quantity' => $i['quantity'] ?? 0, 'status' => $i['status'],
            'location' => $i['location'] ?? '', 'hallmark' => !empty($i['hallmark']),
            'notes' => $i['notes'] ?? '',
            'hs_code' => $i['hsCode'] ?? '', 'stone_amount' => $i['stoneAmount'] ?? 0,
            'created_at' => $i['createdAt'] ?? null, 'updated_at' => $i['updatedAt'] ?? null,
        ];
    }

    // ── transactions ─────────────────────────────────────────────────────────

    private function readTransactions(string $userId): array
    {
        return DB::table('transactions')->where('user_id', $userId)->orderByDesc('position')->get()
            ->map(function ($r) {
                $tx = [
                    'id' => $r->id, 'type' => $r->type, 'itemId' => $r->item_id,
                    'itemName' => $r->item_name, 'quantity' => (float) $r->quantity,
                    'note' => $r->note ?? '', 'createdAt' => $r->created_at,
                ];
                $tx['amount'] = $r->amount !== null ? (float) $r->amount : null;
                return $tx;
            })->all();
    }

    private function transactionToRow(array $t, string $userId): array
    {
        return [
            'id' => $t['id'], 'user_id' => $userId, 'type' => $t['type'],
            'item_id' => $t['itemId'] ?? null, 'item_name' => $t['itemName'] ?? null,
            'quantity' => $t['quantity'] ?? 0, 'amount' => $t['amount'] ?? null,
            'note' => $t['note'] ?? '', 'created_at' => $t['createdAt'] ?? null,
        ];
    }

    // ── orders ───────────────────────────────────────────────────────────────

    private function readOrders(string $userId): array
    {
        return DB::table('orders')->where('user_id', $userId)->orderByDesc('position')->get()
            ->map(function ($r) {
                $rawLines = json_decode($r->lines ?? 'null', true);
                $lines = [];
                $customerGoldGrams = 0; $goldAddedGrams = 0; $remainingPayment = null;
                $goldSource = 'store'; $goldCreditValue = 0;
                if (is_array($rawLines) && array_is_list($rawLines)) {
                    $lines = $rawLines;
                } elseif (is_array($rawLines)) {
                    $lines = is_array($rawLines['items'] ?? null) ? $rawLines['items'] : [];
                    $customerGoldGrams = Pos::num($rawLines['customerGoldGrams'] ?? 0);
                    $goldAddedGrams = Pos::num($rawLines['goldAddedGrams'] ?? 0);
                    if (($rawLines['remainingPayment'] ?? null) !== null) {
                        $remainingPayment = Pos::num($rawLines['remainingPayment']);
                    }
                    $goldSource = Pos::str($rawLines['goldSource'] ?? '') ?: 'store';
                    $goldCreditValue = Pos::num($rawLines['goldCreditValue'] ?? 0);
                }
                return [
                    'id' => $r->id, 'orderNumber' => $r->order_number,
                    'customerName' => $r->customer_name, 'customerPhone' => $r->customer_phone ?? '',
                    'status' => $r->status, 'lines' => $lines,
                    'totalAmount' => (float) $r->total_amount, 'note' => $r->note ?? '',
                    'karigarId' => $r->karigar_id ?: null, 'karigarName' => $r->karigar_name ?? '',
                    'advanceAmount' => (float) $r->advance_amount, 'advancePaid' => (bool) $r->advance_paid,
                    'customerGoldGrams' => $customerGoldGrams, 'goldAddedGrams' => $goldAddedGrams,
                    'remainingPayment' => $remainingPayment,
                    'goldSource' => $goldSource, 'goldCreditValue' => $goldCreditValue,
                    'createdAt' => $r->created_at, 'updatedAt' => $r->updated_at,
                ];
            })->all();
    }

    private function orderToRow(array $o, string $userId): array
    {
        return [
            'id' => $o['id'], 'user_id' => $userId, 'order_number' => $o['orderNumber'],
            'customer_name' => $o['customerName'], 'customer_phone' => $o['customerPhone'] ?? '',
            'status' => $o['status'],
            'lines' => json_encode([
                'items' => $o['lines'] ?? [],
                'customerGoldGrams' => $o['customerGoldGrams'] ?? 0,
                'goldAddedGrams' => $o['goldAddedGrams'] ?? 0,
                'remainingPayment' => $o['remainingPayment'] ?? null,
                'goldSource' => $o['goldSource'] ?? 'store',
                'goldCreditValue' => $o['goldCreditValue'] ?? 0,
            ]),
            'total_amount' => $o['totalAmount'] ?? 0, 'note' => $o['note'] ?? '',
            'karigar_id' => $o['karigarId'] ?? null, 'karigar_name' => $o['karigarName'] ?? '',
            'advance_amount' => $o['advanceAmount'] ?? 0, 'advance_paid' => !empty($o['advancePaid']),
            'created_at' => $o['createdAt'] ?? null, 'updated_at' => $o['updatedAt'] ?? null,
        ];
    }

    // ── customers ────────────────────────────────────────────────────────────

    private function readCustomers(string $userId): array
    {
        return DB::table('customers')->where('user_id', $userId)->orderByDesc('position')->get()
            ->map(fn ($r) => [
                'id' => $r->id, 'name' => $r->name, 'phone' => $r->phone ?? '',
                'email' => $r->email ?? '', 'address' => $r->address ?? '',
                'createdAt' => $r->created_at, 'purchases' => 0,
            ])->all();
    }

    private function customerToRow(array $c, string $userId): array
    {
        return [
            'id' => $c['id'], 'user_id' => $userId, 'name' => $c['name'],
            'phone' => $c['phone'] ?? '', 'email' => $c['email'] ?? '',
            'address' => $c['address'] ?? '',
            'created_at' => $c['createdAt'] ?? Pos::nowIso(),
        ];
    }

    // ── generic sync ─────────────────────────────────────────────────────────

    /**
     * Sync an in-memory list to its table for one user: upsert every record
     * and delete rows that are no longer present. `position` preserves the
     * array order (arrays are newest-first in the app).
     */
    private function syncTable(string $userId, string $table, array $records, callable $toRow): void
    {
        $rows = [];
        $position = count($records);
        foreach ($records as $r) {
            if (!is_array($r) || !isset($r['id'])) continue;
            $row = $toRow($r);
            $row['position'] = $position--;
            $rows[] = $row;
        }
        $keepIds = array_map(fn ($r) => (string) $r['id'], $rows);
        $q = DB::table($table)->where('user_id', $userId);
        if ($keepIds) $q->whereNotIn('id', $keepIds);
        $q->delete();
        foreach (array_chunk($rows, 100) as $chunk) {
            $update = array_keys($chunk[0]);
            DB::table($table)->upsert($chunk, ['user_id', 'id'], array_values(array_diff($update, ['user_id', 'id'])));
        }
    }

    private function syncJsonCollection(string $userId, string $table, array $records): void
    {
        $rows = [];
        $position = count($records);
        foreach ($records as $r) {
            if (!is_array($r) || !isset($r['id'])) continue;
            $rows[] = [
                'user_id' => $userId,
                'id' => (string) $r['id'],
                'data' => json_encode($r),
                'position' => $position--,
            ];
        }
        $keepIds = array_map(fn ($r) => $r['id'], $rows);
        $q = DB::table($table)->where('user_id', $userId);
        if ($keepIds) $q->whereNotIn('id', $keepIds);
        $q->delete();
        foreach (array_chunk($rows, 100) as $chunk) {
            DB::table($table)->upsert($chunk, ['user_id', 'id'], ['data', 'position']);
        }
    }
}
