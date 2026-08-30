<?php

namespace App\Http\Controllers\Api;

use App\Services\MetalRates;
use App\Support\ItemPhoto;
use App\Support\Pos;
use Illuminate\Http\Request;

class ItemController extends ApiController
{
    /** Sequential unique item number: ITM-0001, ITM-0002, … */
    private static function nextItemNumber(array &$store): string
    {
        $n = (int) Pos::num($store['settings']['itemCounter'] ?? 0) + 1;
        $store['settings']['itemCounter'] = $n;
        return 'ITM-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
    }

    public function index(Request $request)
    {
        $store = $this->readStore($request);

        // One-time backfill: give every existing item a unique number
        // (oldest first, so numbering follows the order items were added).
        $changed = false;
        for ($i = count($store['items']) - 1; $i >= 0; $i--) {
            if (empty($store['items'][$i]['itemNumber'])) {
                $store['items'][$i]['itemNumber'] = self::nextItemNumber($store);
                $changed = true;
            }
        }
        if ($changed) $this->writeStore($request, $store);

        $items = $store['items'];
        $q = $request->query('q');
        $category = $request->query('category');
        $status = $request->query('status');
        if ($q) {
            $term = strtolower((string) $q);
            $items = array_values(array_filter($items, fn ($i) =>
                str_contains(strtolower($i['name'] ?? ''), $term)
                || str_contains(strtolower($i['sku'] ?? ''), $term)
                || str_contains(strtolower($i['itemNumber'] ?? ''), $term)
                || str_contains(strtolower($i['location'] ?? ''), $term)
                || str_contains(strtolower($i['notes'] ?? ''), $term)
            ));
        }
        if ($category) $items = array_values(array_filter($items, fn ($i) => ($i['category'] ?? '') === $category));
        if ($status) $items = array_values(array_filter($items, fn ($i) => ($i['status'] ?? '') === $status));
        usort($items, fn ($a, $b) => strcmp($b['updatedAt'] ?? '', $a['updatedAt'] ?? ''));
        $metals = MetalRates::resolve($store);
        return response()->json([
            'items' => $items,
            'goldRatePerTola' => $metals['goldRatePerTola'],
            'silverRatePerTola' => $metals['silverRatePerTola'],
            'metalRatesLive' => $metals['live'], 'metalCurrency' => $metals['currency'],
            'metalRatesError' => $metals['liveError'] ?? null,
        ]);
    }

    public function show(Request $request, string $id)
    {
        $store = $this->readStore($request);
        foreach ($store['items'] as $item) {
            if (($item['id'] ?? null) === $id) return response()->json($item);
        }
        return $this->fail('Item not found.', 404);
    }

    public function store_(Request $request)
    {
        $store = $this->readStore($request);
        $body = $request->json()->all();
        if (empty($body['name']) || empty($body['sku'])) return $this->fail('Name and SKU are required.');
        $metalError = Pos::validateInventoryMetalFields($body);
        if ($metalError) return $this->fail($metalError);
        foreach ($store['items'] as $i) {
            if (($i['sku'] ?? null) === $body['sku']) return $this->fail('SKU already exists.');
        }
        $now = Pos::nowIso();
        $item = Pos::normalizeItemRecord([
            'id' => Pos::newId('sp'),
            'sku' => Pos::str($body['sku']), 'name' => Pos::str($body['name']),
            'category' => $body['category'] ?? 'gold',
            'karat' => Pos::num($body['karat'] ?? 0) ?: 24,
            'weightGrams' => Pos::num($body['weightGrams'] ?? 0),
            'weightUnit' => ($body['weightUnit'] ?? '') === 'tola' ? 'tola' : 'grams',
            'makingCharge' => Pos::num($body['makingCharge'] ?? 0),
            'jartiRateType' => Pos::str($body['jartiRateType'] ?? 'flat') ?: 'flat',
            'jartiRateValue' => Pos::num($body['jartiRateValue'] ?? 0),
            'hallmarkNumber' => Pos::str($body['hallmarkNumber'] ?? ''),
            'hallmarkDate' => Pos::str($body['hallmarkDate'] ?? ''),
            'purchaseCost' => Pos::num($body['purchaseCost'] ?? 0),
            'salePrice' => Pos::num($body['salePrice'] ?? 0),
            'customRatePerTola' => Pos::num($body['customRatePerTola'] ?? 0),
            'quantity' => max(0, Pos::num($body['quantity'] ?? 0)),
            'status' => $body['status'] ?? 'in_stock',
            'location' => Pos::str($body['location'] ?? ''),
            'hallmark' => !empty($body['hallmark']),
            'notes' => Pos::str($body['notes'] ?? ''),
            'hsCode' => Pos::str($body['hsCode'] ?? ''),
            'stoneAmount' => max(0, round(Pos::num($body['stoneAmount'] ?? 0))),
            // The picture arrives on its own request once the item has an id.
            'photoPath' => null, 'photoUrl' => null,
            'createdAt' => $now, 'updatedAt' => $now,
        ], true);
        $item['itemNumber'] = self::nextItemNumber($store);
        array_unshift($store['items'], $item);
        $this->writeStore($request, $store);
        return response()->json($item, 201);
    }

    public function update(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $idx = null;
        foreach ($store['items'] as $i => $item) if (($item['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Item not found.', 404);
        $existing = $store['items'][$idx];
        if (Pos::isItemSoldOut($existing)) return $this->fail('Sold out items cannot be edited.');
        $body = $request->json()->all();
        if (!empty($body['sku']) && $body['sku'] !== $existing['sku']) {
            foreach ($store['items'] as $i) {
                if (($i['sku'] ?? null) === $body['sku']) return $this->fail('SKU already exists.');
            }
        }
        $name = ($body['name'] ?? null) !== null ? Pos::str($body['name']) : $existing['name'];
        if ($name === '') return $this->fail('Name is required.');
        $metalError = Pos::validateInventoryMetalFields([
            'category' => ($body['category'] ?? null) !== null ? $body['category'] : $existing['category'],
            'customRatePerTola' => ($body['customRatePerTola'] ?? null) !== null ? $body['customRatePerTola'] : ($existing['customRatePerTola'] ?? 0),
        ]);
        if ($metalError) return $this->fail($metalError);
        $updated = Pos::normalizeItemRecord([
            'id' => $existing['id'],
            'sku' => ($body['sku'] ?? null) !== null ? Pos::str($body['sku']) : $existing['sku'],
            'name' => $name,
            'category' => ($body['category'] ?? null) !== null ? $body['category'] : $existing['category'],
            'karat' => ($body['karat'] ?? null) !== null ? (Pos::num($body['karat']) ?: $existing['karat']) : $existing['karat'],
            'weightGrams' => ($body['weightGrams'] ?? null) !== null ? Pos::num($body['weightGrams']) : $existing['weightGrams'],
            'weightUnit' => ($body['weightUnit'] ?? null) !== null ? (($body['weightUnit'] === 'tola') ? 'tola' : 'grams') : ($existing['weightUnit'] ?? 'grams'),
            'makingCharge' => ($body['makingCharge'] ?? null) !== null ? Pos::num($body['makingCharge']) : $existing['makingCharge'],
            'jartiRateType' => ($body['jartiRateType'] ?? null) !== null ? Pos::str($body['jartiRateType']) : ($existing['jartiRateType'] ?? 'flat'),
            'jartiRateValue' => ($body['jartiRateValue'] ?? null) !== null ? Pos::num($body['jartiRateValue']) : ($existing['jartiRateValue'] ?? 0),
            'hallmarkNumber' => ($body['hallmarkNumber'] ?? null) !== null ? Pos::str($body['hallmarkNumber']) : ($existing['hallmarkNumber'] ?? ''),
            'hallmarkDate' => ($body['hallmarkDate'] ?? null) !== null ? Pos::str($body['hallmarkDate']) : ($existing['hallmarkDate'] ?? ''),
            'purchaseCost' => ($body['purchaseCost'] ?? null) !== null ? Pos::num($body['purchaseCost']) : $existing['purchaseCost'],
            'salePrice' => ($body['salePrice'] ?? null) !== null ? Pos::num($body['salePrice']) : ($existing['salePrice'] ?? 0),
            'customRatePerTola' => ($body['customRatePerTola'] ?? null) !== null ? Pos::num($body['customRatePerTola']) : ($existing['customRatePerTola'] ?? 0),
            'quantity' => ($body['quantity'] ?? null) !== null ? Pos::num($body['quantity']) : $existing['quantity'],
            'status' => ($body['status'] ?? null) !== null ? $body['status'] : $existing['status'],
            'location' => ($body['location'] ?? null) !== null ? Pos::str($body['location']) : ($existing['location'] ?? ''),
            'hallmark' => ($body['hallmark'] ?? null) !== null ? (bool) $body['hallmark'] : $existing['hallmark'],
            'notes' => ($body['notes'] ?? null) !== null ? Pos::str($body['notes']) : ($existing['notes'] ?? ''),
            'hsCode' => ($body['hsCode'] ?? null) !== null ? Pos::str($body['hsCode']) : ($existing['hsCode'] ?? ''),
            'stoneAmount' => ($body['stoneAmount'] ?? null) !== null ? max(0, round(Pos::num($body['stoneAmount']))) : ($existing['stoneAmount'] ?? 0),
            // Editing an item's fields never touches its picture; that has
            // its own upload and delete routes.
            'photoPath' => $existing['photoPath'] ?? null,
            'photoUrl' => $existing['photoUrl'] ?? null,
            'createdAt' => $existing['createdAt'], 'updatedAt' => Pos::nowIso(),
        ]);
        $updated['itemNumber'] = $existing['itemNumber'] ?? '';
        $store['items'][$idx] = $updated;
        $this->writeStore($request, $store);
        return response()->json($updated);
    }

    public function destroy(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $before = count($store['items']);
        // Held onto so the file goes only once the row is definitely gone —
        // deleting it first would orphan the picture if the write failed.
        $photo = null;
        foreach ($store['items'] as $item) {
            if (($item['id'] ?? null) === $id) { $photo = $item['photoPath'] ?? null; break; }
        }
        $store['items'] = array_values(array_filter($store['items'], fn ($i) => ($i['id'] ?? null) !== $id));
        if (count($store['items']) === $before) return $this->fail('Item not found.', 404);
        $this->writeStore($request, $store);
        ItemPhoto::delete($photo);
        return response()->json(['ok' => true]);
    }
}
