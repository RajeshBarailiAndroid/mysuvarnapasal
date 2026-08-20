<?php

namespace App\Http\Controllers\Api;

use App\Support\Pos;
use App\Support\StoreLogic;
use Illuminate\Http\Request;

class SchemeController extends ApiController
{
    public function index(Request $request)
    {
        $store = $this->readStore($request);
        $schemes = $store['schemes'] ?? [];
        if ($request->query('status')) {
            $schemes = array_values(array_filter($schemes, fn ($s) => ($s['status'] ?? '') === $request->query('status')));
        }
        usort($schemes, fn ($a, $b) => strcmp($b['createdAt'] ?? '', $a['createdAt'] ?? ''));
        return response()->json([
            'schemes' => array_map(fn ($s) => array_merge($s, ['paidTotal' => Pos::schemePaidTotal($s)]), $schemes),
        ]);
    }

    public function store_(Request $request)
    {
        $store = $this->readStore($request);
        if (!is_array($store['schemes'] ?? null)) $store['schemes'] = [];
        $body = $request->json()->all();
        $customerName = Pos::str($body['customerName'] ?? '');
        $monthlyAmount = max(0, Pos::num($body['monthlyAmount'] ?? 0));
        $durationMonths = max(1, (int) floor(Pos::num($body['durationMonths'] ?? 0, 0) ?: 12));
        if ($customerName === '') return $this->fail('Customer name is required.');
        if ($monthlyAmount <= 0) return $this->fail('Monthly amount must be greater than 0.');
        $now = Pos::nowIso();
        $scheme = [
            'id' => Pos::newId('gs'), 'schemeNumber' => StoreLogic::nextSchemeNumber($store), 'status' => 'active',
            'customerName' => $customerName, 'customerPhone' => Pos::str($body['customerPhone'] ?? ''),
            'monthlyAmount' => $monthlyAmount, 'durationMonths' => $durationMonths,
            'startDate' => Pos::str($body['startDate'] ?? '') ?: substr($now, 0, 10),
            'installments' => [],
            'notes' => Pos::str($body['notes'] ?? ''),
            'createdAt' => $now, 'updatedAt' => $now,
        ];
        array_unshift($store['schemes'], $scheme);
        StoreLogic::upsertCustomerInStore($store, ['name' => $customerName, 'phone' => $scheme['customerPhone']]);
        $this->writeStore($request, $store);
        return response()->json(array_merge($scheme, ['paidTotal' => 0]), 201);
    }

    public function addInstallment(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $idx = null;
        foreach (($store['schemes'] ?? []) as $i => $s) if (($s['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Scheme not found.', 404);
        $scheme = $store['schemes'][$idx];
        if (($scheme['status'] ?? '') !== 'active') {
            return $this->fail("Scheme is {$scheme['status']}; deposits are only allowed while active.");
        }
        $body = $request->json()->all();
        $amount = max(0, Pos::num($body['amount'] ?? 0));
        if ($amount <= 0) return $this->fail('Deposit amount must be greater than 0.');
        $now = Pos::nowIso();
        $installment = [
            'id' => Pos::newId('ins'), 'amount' => $amount,
            'date' => Pos::str($body['date'] ?? '') ?: substr($now, 0, 10),
            'method' => in_array($body['method'] ?? null, Pos::PAYMENT_METHODS, true) ? $body['method'] : 'cash',
            'note' => Pos::str($body['note'] ?? ''), 'createdAt' => $now,
        ];
        if (!is_array($scheme['installments'] ?? null)) $scheme['installments'] = [];
        $scheme['installments'][] = $installment;
        $paidTotal = Pos::schemePaidTotal($scheme);
        if (count($scheme['installments']) >= ($scheme['durationMonths'] ?? 0)
            || $paidTotal >= Pos::num($scheme['monthlyAmount'] ?? 0) * Pos::num($scheme['durationMonths'] ?? 0)) {
            $scheme['status'] = 'matured';
        }
        $scheme['updatedAt'] = $now;
        $store['schemes'][$idx] = $scheme;
        $this->writeStore($request, $store);
        return response()->json([
            'installment' => $installment,
            'scheme' => array_merge($scheme, ['paidTotal' => $paidTotal]),
        ], 201);
    }

    public function update(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $idx = null;
        foreach (($store['schemes'] ?? []) as $i => $s) if (($s['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Scheme not found.', 404);
        $scheme = $store['schemes'][$idx];
        if (($scheme['status'] ?? '') === 'redeemed') {
            return $this->fail('Redeemed schemes cannot be changed. Void the linked sale to reactivate.');
        }
        $body = $request->json()->all();
        if (($body['status'] ?? null) !== null) {
            if (!in_array((string) $body['status'], ['active', 'matured', 'cancelled'], true)) {
                return $this->fail('Invalid scheme status.');
            }
            $scheme['status'] = (string) $body['status'];
        }
        if (($body['notes'] ?? null) !== null) $scheme['notes'] = Pos::str($body['notes']);
        if (($body['customerPhone'] ?? null) !== null) $scheme['customerPhone'] = Pos::str($body['customerPhone']);
        $scheme['updatedAt'] = Pos::nowIso();
        $store['schemes'][$idx] = $scheme;
        $this->writeStore($request, $store);
        return response()->json(array_merge($scheme, ['paidTotal' => Pos::schemePaidTotal($scheme)]));
    }
}
