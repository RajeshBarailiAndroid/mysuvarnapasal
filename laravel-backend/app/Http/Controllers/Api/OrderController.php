<?php

namespace App\Http\Controllers\Api;

use App\Services\MetalRates;
use App\Support\Pos;
use App\Support\StoreLogic;
use Illuminate\Http\Request;

class OrderController extends ApiController
{
    public function index(Request $request)
    {
        $store = $this->readStore($request);
        $orders = $store['orders'] ?? [];
        $status = $request->query('status');
        if ($status) $orders = array_values(array_filter($orders, fn ($o) => ($o['status'] ?? '') === $status));
        usort($orders, fn ($a, $b) => strcmp($b['createdAt'] ?? '', $a['createdAt'] ?? ''));
        $metals = MetalRates::resolve($store);
        return response()->json([
            'orders' => $orders, 'goldRatePerTola' => $metals['goldRatePerTola'],
            'metalRatesLive' => $metals['live'], 'metalCurrency' => $metals['currency'],
        ]);
    }

    public function show(Request $request, string $id)
    {
        $store = $this->readStore($request);
        foreach (($store['orders'] ?? []) as $order) {
            if (($order['id'] ?? null) === $id) return response()->json($order);
        }
        return $this->fail('Order not found.', 404);
    }

    public function store_(Request $request)
    {
        $store = $this->readStore($request);
        if (!is_array($store['orders'] ?? null)) $store['orders'] = [];
        $body = $request->json()->all();
        $customerName = Pos::str($body['customerName'] ?? '');
        $quantity = max(1, Pos::num($body['quantity'] ?? 0, 0) ?: 1);
        if ($customerName === '') return $this->fail('Customer name is required.');
        $metals = MetalRates::resolve($store);
        $now = Pos::nowIso();
        if (($body['orderItemMode'] ?? null) === 'custom' || !empty($body['customItem'])) {
            try {
                $line = StoreLogic::buildCustomOrderLine($body, $quantity, $metals);
            } catch (\RuntimeException $err) {
                return $this->fail($err->getMessage());
            }
        } else {
            $itemId = Pos::str($body['itemId'] ?? '');
            if ($itemId === '') return $this->fail('Item is required.');
            $item = null;
            foreach ($store['items'] as $i) if (($i['id'] ?? null) === $itemId) { $item = $i; break; }
            if (!$item) return $this->fail('Item not found.', 404);
            if ($item['quantity'] < $quantity) return $this->fail('Not enough stock for this order.');
            $line = StoreLogic::buildOrderLine($item, $quantity, $metals);
        }
        // ── Gold source: store gold / customer's own gold / partial ──
        $goldSource = in_array($body['goldSource'] ?? 'store', ['store', 'customer', 'partial'], true)
            ? $body['goldSource'] : 'store';
        $orderTotal = Pos::num($line['lineTotal'] ?? 0);
        $goldCreditValue = 0;
        $autoGoldAdded = null;
        if ($goldSource !== 'store') {
            $unitWeight = Pos::num($line['weightGrams'] ?? 0);
            $jartiWeight = Pos::num($line['jartiWeightGrams'] ?? 0);
            $qty = max(1, Pos::num($line['quantity'] ?? 1, 1));
            // Jarti (wastage) gold is part of what the piece consumes.
            $totalWeight = ($unitWeight + $jartiWeight) * $qty;
            $customerGold = max(0, Pos::num($body['customerGoldGrams'] ?? 0));
            $creditGrams = min($customerGold, $totalWeight);
            $slug = strtolower(Pos::str($line['category'] ?? 'gold') ?: 'gold');
            $rate = Pos::num($line['ratePerTola'] ?? 0);
            if ($rate <= 0) {
                $rate = $slug === 'silver'
                    ? Pos::num($metals['silverRatePerTola'] ?? 0)
                    : Pos::num($metals['goldRatePerTola'] ?? 0);
            }
            $kf = $slug === 'gold' ? ((Pos::num($line['karat'] ?? 0) ?: 24) / 24) : 1;
            $goldCreditValue = (int) round(($creditGrams / Pos::TOLA_GRAMS) * $rate * $kf);
            $orderTotal = max(0, $orderTotal - $goldCreditValue);
            $autoGoldAdded = max(0, $totalWeight - $creditGrams);
        }

        $hasAdvance = ($body['advanceAmount'] ?? null) !== '' && ($body['advanceAmount'] ?? null) !== null;
        $hasCustomerGold = ($body['customerGoldGrams'] ?? null) !== '' && ($body['customerGoldGrams'] ?? null) !== null;
        $hasGoldAdded = ($body['goldAddedGrams'] ?? null) !== '' && ($body['goldAddedGrams'] ?? null) !== null;
        $hasRemaining = ($body['remainingPayment'] ?? null) !== '' && ($body['remainingPayment'] ?? null) !== null;
        $advanceAmount = $hasAdvance ? Pos::num($body['advanceAmount']) : 0;
        $customerGoldGrams = $hasCustomerGold ? Pos::num($body['customerGoldGrams']) : 0;
        $goldAddedGrams = $hasGoldAdded ? Pos::num($body['goldAddedGrams']) : 0;
        $hasPaymentInfo = $hasAdvance || !empty($body['advancePaid']) || $hasCustomerGold || $hasGoldAdded || $hasRemaining;
        $remainingPayment = null;
        if ($hasRemaining) {
            $remainingPayment = Pos::numOrNull($body['remainingPayment']);
            if ($remainingPayment === null) $remainingPayment = max(0, $orderTotal - $advanceAmount);
        } elseif ($hasPaymentInfo || $goldSource !== 'store') {
            $remainingPayment = max(0, $orderTotal - $advanceAmount);
        }
        $order = [
            'id' => Pos::newId('ord'), 'orderNumber' => StoreLogic::nextOrderNumber($store),
            'customerName' => $customerName, 'customerPhone' => Pos::str($body['customerPhone'] ?? ''),
            'status' => 'pending', 'lines' => [$line],
            'totalAmount' => $orderTotal, 'note' => Pos::str($body['note'] ?? ''),
            'goldSource' => $goldSource, 'goldCreditValue' => $goldCreditValue,
            'karigarId' => Pos::str($body['karigarId'] ?? '') ?: null,
            'karigarName' => Pos::str($body['karigarName'] ?? ''),
            'advanceAmount' => $advanceAmount, 'advancePaid' => !empty($body['advancePaid']),
            'customerGoldGrams' => $customerGoldGrams,
            'goldAddedGrams' => $autoGoldAdded !== null && !$hasGoldAdded ? $autoGoldAdded : $goldAddedGrams,
            'remainingPayment' => $remainingPayment,
            'createdAt' => $now, 'updatedAt' => $now,
        ];
        StoreLogic::upsertCustomerInStore($store, ['name' => $customerName, 'phone' => $order['customerPhone']]);
        array_unshift($store['orders'], $order);
        $this->writeStore($request, $store);
        return response()->json($order, 201);
    }

    public function update(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $idx = null;
        foreach (($store['orders'] ?? []) as $i => $o) if (($o['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Order not found.', 404);
        $order = $store['orders'][$idx];
        $body = $request->json()->all();
        $allowed = ['pending', 'confirmed', 'progress', 'ready', 'completed', 'cancelled'];
        $nextStatus = $body['status'] ?? $order['status'];
        if (!in_array($nextStatus, $allowed, true)) return $this->fail('Invalid order status.');
        if ($nextStatus === 'completed' && $order['status'] !== 'completed') {
            try {
                StoreLogic::applyOrderCompletion($store, $order);
            } catch (\RuntimeException $err) {
                return $this->fail($err->getMessage());
            }
        } elseif ($nextStatus !== 'completed' && $order['status'] === 'completed') {
            StoreLogic::revertOrderCompletion($store, $order);
        }
        if (($body['customerName'] ?? null) !== null) $order['customerName'] = Pos::str($body['customerName']);
        if (($body['customerPhone'] ?? null) !== null) $order['customerPhone'] = Pos::str($body['customerPhone']);
        if (($body['note'] ?? null) !== null) $order['note'] = Pos::str($body['note']);
        if (array_key_exists('karigarId', $body)) $order['karigarId'] = Pos::str($body['karigarId'] ?? '') ?: null;
        if (($body['karigarName'] ?? null) !== null) $order['karigarName'] = Pos::str($body['karigarName']);
        if (($body['advanceAmount'] ?? null) !== null) $order['advanceAmount'] = $body['advanceAmount'] === '' ? 0 : Pos::num($body['advanceAmount']);
        if (($body['advancePaid'] ?? null) !== null) $order['advancePaid'] = (bool) $body['advancePaid'];
        if (($body['customerGoldGrams'] ?? null) !== null) $order['customerGoldGrams'] = $body['customerGoldGrams'] === '' ? 0 : Pos::num($body['customerGoldGrams']);
        if (($body['goldAddedGrams'] ?? null) !== null) $order['goldAddedGrams'] = $body['goldAddedGrams'] === '' ? 0 : Pos::num($body['goldAddedGrams']);
        if (($body['remainingPayment'] ?? null) !== null) {
            if ($body['remainingPayment'] === '') {
                $order['remainingPayment'] = max(0, Pos::num($order['totalAmount'] ?? 0) - Pos::num($order['advanceAmount'] ?? 0));
            } else {
                $parsed = Pos::numOrNull($body['remainingPayment']);
                $order['remainingPayment'] = $parsed !== null ? $parsed : 0;
            }
        }
        $order['status'] = $nextStatus;
        $order['updatedAt'] = Pos::nowIso();
        $store['orders'][$idx] = $order;
        $this->writeStore($request, $store);
        return response()->json($order);
    }

    public function destroy(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $order = null;
        foreach (($store['orders'] ?? []) as $o) if (($o['id'] ?? null) === $id) { $order = $o; break; }
        if (!$order) return $this->fail('Order not found.', 404);
        if (($order['status'] ?? '') === 'completed') StoreLogic::revertOrderCompletion($store, $order);
        $store['orders'] = array_values(array_filter($store['orders'], fn ($o) => ($o['id'] ?? null) !== $id));
        $this->writeStore($request, $store);
        return response()->json(['ok' => true]);
    }
}
