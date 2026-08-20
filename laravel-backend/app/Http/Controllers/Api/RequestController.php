<?php

namespace App\Http\Controllers\Api;

use App\Support\Pos;
use App\Support\StoreLogic;
use Illuminate\Http\Request as HttpRequest;

/**
 * Customer item requests ("requested items").
 *
 * A walk-in customer asks to see / wants a piece the shop does not have on
 * the shelf. This records who asked and every item they asked for, so the
 * shop can show the list back later and follow up. It is deliberately NOT
 * an order: nothing is reserved, priced, or deducted from stock.
 */
class RequestController extends ApiController
{
    public const STATUSES = ['open', 'fulfilled', 'cancelled'];

    /** Normalise one incoming item row; returns null when there is no name. */
    private function itemFromInput($raw): ?array
    {
        if (!is_array($raw)) return null;
        $name = Pos::str($raw['name'] ?? '');
        if ($name === '') return null;
        return [
            'id' => Pos::str($raw['id'] ?? '') ?: Pos::newId('ri'),
            'itemId' => Pos::str($raw['itemId'] ?? '') ?: null,
            // Inventory code + unit, kept so the Requested list can show them
            // (and so editing a request does not drop what the link sent).
            'itemCode' => mb_substr(Pos::str($raw['itemCode'] ?? ''), 0, 60),
            'unit' => mb_substr(Pos::str($raw['unit'] ?? ''), 0, 40),
            'name' => mb_substr($name, 0, 200),
            'category' => Pos::str($raw['category'] ?? ''),
            'karat' => Pos::num($raw['karat'] ?? 0),
            'weightGrams' => max(0, Pos::num($raw['weightGrams'] ?? 0)),
            'quantity' => max(1, (int) Pos::num($raw['quantity'] ?? 1)),
            'price' => max(0, Pos::num($raw['price'] ?? 0)),
            'note' => mb_substr(Pos::str($raw['note'] ?? ''), 0, 300),
        ];
    }

    /** @return array<int, array> */
    private function itemsFromInput($raw): array
    {
        if (!is_array($raw)) return [];
        $items = [];
        foreach ($raw as $row) {
            $item = $this->itemFromInput($row);
            if ($item) $items[] = $item;
        }
        return $items;
    }

    public function index(HttpRequest $request)
    {
        $store = $this->readStore($request);
        $requests = $store['requests'] ?? [];
        if ($request->query('status')) {
            $status = (string) $request->query('status');
            $requests = array_values(array_filter($requests, fn ($r) => ($r['status'] ?? '') === $status));
        }
        usort($requests, fn ($a, $b) => strcmp($b['createdAt'] ?? '', $a['createdAt'] ?? ''));
        return response()->json([
            'requests' => $requests,
            'openCount' => count(array_filter($store['requests'] ?? [], fn ($r) => ($r['status'] ?? '') === 'open')),
        ]);
    }

    public function store_(HttpRequest $request)
    {
        $store = $this->readStore($request);
        if (!is_array($store['requests'] ?? null)) $store['requests'] = [];
        $body = $request->json()->all();

        $customerName = Pos::str($body['customerName'] ?? '');
        if ($customerName === '') return $this->fail('Customer name is required.');
        $items = $this->itemsFromInput($body['items'] ?? []);
        if (!$items) return $this->fail('Add at least one requested item.');

        $now = Pos::nowIso();
        $entry = [
            'id' => Pos::newId('req'),
            'requestNumber' => StoreLogic::nextRequestNumber($store),
            'status' => 'open',
            'customerName' => mb_substr($customerName, 0, 120),
            'customerPhone' => Pos::str($body['customerPhone'] ?? ''),
            'items' => $items,
            'note' => mb_substr(Pos::str($body['note'] ?? ''), 0, 500),
            'fulfilledAt' => null,
            'createdAt' => $now,
            'updatedAt' => $now,
        ];
        array_unshift($store['requests'], $entry);
        StoreLogic::upsertCustomerInStore($store, ['name' => $entry['customerName'], 'phone' => $entry['customerPhone']]);
        $this->writeStore($request, $store);
        return response()->json($entry, 201);
    }

    public function update(HttpRequest $request, string $id)
    {
        $store = $this->readStore($request);
        $idx = null;
        foreach (($store['requests'] ?? []) as $i => $r) {
            if (($r['id'] ?? null) === $id) { $idx = $i; break; }
        }
        if ($idx === null) return $this->fail('Request not found.', 404);

        $entry = $store['requests'][$idx];
        $body = $request->json()->all();
        $now = Pos::nowIso();

        if (($body['status'] ?? null) !== null) {
            $next = (string) $body['status'];
            if (!in_array($next, self::STATUSES, true)) return $this->fail('Invalid request status.');
            $entry['fulfilledAt'] = $next === 'fulfilled' ? $now : null;
            $entry['status'] = $next;
        }
        if (($body['customerName'] ?? null) !== null) {
            $entry['customerName'] = mb_substr(Pos::str($body['customerName']), 0, 120) ?: $entry['customerName'];
        }
        if (($body['customerPhone'] ?? null) !== null) $entry['customerPhone'] = Pos::str($body['customerPhone']);
        if (array_key_exists('items', $body)) {
            $items = $this->itemsFromInput($body['items']);
            if (!$items) return $this->fail('Add at least one requested item.');
            $entry['items'] = $items;
        }
        if (($body['note'] ?? null) !== null) $entry['note'] = mb_substr(Pos::str($body['note']), 0, 500);

        $entry['updatedAt'] = $now;
        $store['requests'][$idx] = $entry;
        $this->writeStore($request, $store);
        return response()->json($entry);
    }

    public function destroy(HttpRequest $request, string $id)
    {
        $store = $this->readStore($request);
        $found = null;
        foreach (($store['requests'] ?? []) as $r) {
            if (($r['id'] ?? null) === $id) { $found = $r; break; }
        }
        if (!$found) return $this->fail('Request not found.', 404);
        $store['requests'] = array_values(array_filter(
            $store['requests'],
            fn ($r) => ($r['id'] ?? null) !== $id
        ));
        $this->writeStore($request, $store);
        return response()->json(['ok' => true]);
    }
}
