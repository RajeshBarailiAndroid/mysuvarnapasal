<?php

namespace App\Http\Controllers\Api;

use App\Services\MetalRates;
use App\Support\Pos;
use Illuminate\Http\Request;

class TransactionController extends ApiController
{
    public function index(Request $request)
    {
        $store = $this->readStore($request);
        $txs = $store['transactions'];
        usort($txs, fn ($a, $b) => strcmp($b['createdAt'] ?? '', $a['createdAt'] ?? ''));
        return response()->json(['transactions' => $txs]);
    }

    public function store_(Request $request)
    {
        $store = $this->readStore($request);
        $body = $request->json()->all();
        $type = $body['type'] ?? null;
        $quantity = $body['quantity'] ?? null;
        $note = $body['note'] ?? '';
        if (!empty($body['customItem'])) {
            $itemName = Pos::str($body['itemName'] ?? '');
            $qty = max(1, Pos::num($quantity, 0) ?: 1);
            $amount = Pos::numOrNull($body['amount'] ?? null);
            if ($itemName === '') return $this->fail('Item name is required for custom sales.');
            if ($amount === null || $amount < 0) return $this->fail('A valid amount is required for custom sales.');
            $tx = [
                'id' => Pos::newId('tx'), 'type' => 'sale', 'itemId' => null, 'itemName' => $itemName,
                'quantity' => $qty, 'amount' => $amount, 'note' => Pos::str($note), 'createdAt' => Pos::nowIso(),
            ];
            array_unshift($store['transactions'], $tx);
            $this->writeStore($request, $store);
            return response()->json(['transaction' => $tx], 201);
        }
        $itemId = $body['itemId'] ?? null;
        if (!$type || !$itemId || !$quantity) return $this->fail('Type, item, and quantity are required.');
        $idx = null;
        foreach ($store['items'] as $i => $item) if (($item['id'] ?? null) === $itemId) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Item not found.', 404);
        $item = &$store['items'][$idx];
        $qty = max(1, (int) floor(Pos::num($quantity, 1)));
        if ($qty > 100000) return $this->fail('Quantity is too large.');
        if ($type === 'stock_in') {
            $item['quantity'] += $qty;
            $item['status'] = 'in_stock';
        } elseif ($type === 'sale' || $type === 'stock_out') {
            if ($item['quantity'] < $qty) return $this->fail('Not enough stock.');
            $item['quantity'] -= $qty;
            if ($item['quantity'] == 0) $item['status'] = 'sold_out';
        } else {
            return $this->fail('Invalid transaction type.');
        }
        $item['updatedAt'] = Pos::nowIso();
        $metals = MetalRates::resolve($store);
        $amount = $type === 'sale' ? Pos::itemValue($item, $metals) * $qty : 0;
        $tx = [
            'id' => Pos::newId('tx'), 'type' => $type, 'itemId' => $item['id'], 'itemName' => $item['name'],
            'quantity' => $qty, 'amount' => $amount, 'note' => Pos::str($note), 'createdAt' => Pos::nowIso(),
        ];
        array_unshift($store['transactions'], $tx);
        $itemCopy = $item;
        unset($item);
        $this->writeStore($request, $store);
        return response()->json(['transaction' => $tx, 'item' => $itemCopy], 201);
    }
}
