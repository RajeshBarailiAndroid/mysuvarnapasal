<?php

namespace App\Http\Controllers\Api;

use App\Support\Pos;
use Illuminate\Http\Request;

/** Options (Taken / Given / Kept) ledger. */
class OptionController extends ApiController
{
    public function index(Request $request)
    {
        $store = $this->readStore($request);
        return response()->json($store['options'] ?? []);
    }

    public function store_(Request $request)
    {
        $store = $this->readStore($request);
        if (!is_array($store['options'] ?? null)) $store['options'] = [];
        $body = $request->json()->all();
        $name = Pos::str($body['name'] ?? '');
        if ($name === '') return $this->fail('Name is required.');
        $type = in_array($body['type'] ?? null, ['taken', 'given', 'kept', 'credit', 'borrow', 'deposit'], true) ? $body['type'] : 'credit';
        $now = Pos::nowIso();
        $metal = in_array($body['metal'] ?? null, ['cash', 'gold', 'silver', 'other'], true)
            ? $body['metal']
            : (Pos::num($body['weightGrams'] ?? 0) > 0 ? 'gold' : 'cash');
        $option = [
            'id' => Pos::newId('opt'), 'type' => $type, 'metal' => $metal, 'name' => $name,
            'item' => Pos::str($body['item'] ?? ''),
            'weightGrams' => Pos::num($body['weightGrams'] ?? 0),
            'karat' => Pos::num($body['karat'] ?? 0) ?: 22,
            'rate' => Pos::num($body['rate'] ?? 0),
            'cost' => Pos::num($body['cost'] ?? 0),
            'date' => Pos::str($body['date'] ?? '') ?: substr($now, 0, 10),
            'committedDate' => (string) ($body['committedDate'] ?? ''),
            'notes' => Pos::str($body['notes'] ?? ''),
            'payments' => [],
            'status' => 'open',
            'createdAt' => $now, 'updatedAt' => $now,
        ];
        array_unshift($store['options'], $option);
        $this->writeStore($request, $store);
        return response()->json($option, 201);
    }

    public function update(Request $request, string $id)
    {
        $store = $this->readStore($request);
        if (!is_array($store['options'] ?? null)) $store['options'] = [];
        $idx = null;
        foreach ($store['options'] as $i => $o) if (($o['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Option not found.', 404);
        $opt = $store['options'][$idx];
        $body = $request->json()->all();
        if (($body['name'] ?? null) !== null) $opt['name'] = Pos::str($body['name']);
        if (($body['item'] ?? null) !== null) $opt['item'] = Pos::str($body['item']);
        if (($body['type'] ?? null) !== null && in_array($body['type'], ['taken', 'given', 'kept', 'credit', 'borrow', 'deposit'], true)) $opt['type'] = $body['type'];
        if (($body['metal'] ?? null) !== null && in_array($body['metal'], ['cash', 'gold', 'silver', 'other'], true)) $opt['metal'] = $body['metal'];
        if (($body['weightGrams'] ?? null) !== null) $opt['weightGrams'] = Pos::num($body['weightGrams']);
        if (($body['karat'] ?? null) !== null) $opt['karat'] = Pos::num($body['karat']) ?: 22;
        if (($body['rate'] ?? null) !== null) $opt['rate'] = Pos::num($body['rate']);
        if (($body['cost'] ?? null) !== null) $opt['cost'] = Pos::num($body['cost']);
        if (($body['date'] ?? null) !== null) $opt['date'] = (string) $body['date'];
        if (($body['committedDate'] ?? null) !== null) $opt['committedDate'] = (string) $body['committedDate'];
        if (($body['notes'] ?? null) !== null) $opt['notes'] = Pos::str($body['notes']);
        if (($body['status'] ?? null) !== null && in_array($body['status'], ['open', 'closed'], true)) $opt['status'] = $body['status'];
        $opt['updatedAt'] = Pos::nowIso();
        $store['options'][$idx] = $opt;
        $this->writeStore($request, $store);
        return response()->json($opt);
    }

    public function destroy(Request $request, string $id)
    {
        $store = $this->readStore($request);
        if (!is_array($store['options'] ?? null)) $store['options'] = [];
        $before = count($store['options']);
        $store['options'] = array_values(array_filter($store['options'], fn ($o) => ($o['id'] ?? null) !== $id));
        if (count($store['options']) === $before) return $this->fail('Option not found.', 404);
        $this->writeStore($request, $store);
        return response()->json(['ok' => true]);
    }

    public function addPayment(Request $request, string $id)
    {
        $store = $this->readStore($request);
        if (!is_array($store['options'] ?? null)) $store['options'] = [];
        $idx = null;
        foreach ($store['options'] as $i => $o) if (($o['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Option not found.', 404);
        $opt = $store['options'][$idx];
        if (!empty($opt['saleId'])) return $this->fail('This record is linked to an invoice — receive payments in Reports → Invoices.');
        $body = $request->json()->all();
        $amount = Pos::num($body['amount'] ?? 0);
        if ($amount <= 0) return $this->fail('Payment amount must be greater than 0.');
        $now = Pos::nowIso();
        $payment = [
            'id' => Pos::newId('pay'), 'amount' => $amount,
            'date' => Pos::str($body['date'] ?? '') ?: substr($now, 0, 10),
            'note' => Pos::str($body['note'] ?? ''),
            'createdAt' => $now,
        ];
        if (!is_array($opt['payments'] ?? null)) $opt['payments'] = [];
        $opt['payments'][] = $payment;
        $opt['updatedAt'] = $now;
        $store['options'][$idx] = $opt;
        $this->writeStore($request, $store);
        return response()->json(['payment' => $payment, 'option' => $opt], 201);
    }

    /** Edit a payment entry (amount / date / note) on a record. */
    public function updatePayment(Request $request, string $id, string $paymentId)
    {
        $store = $this->readStore($request);
        if (!is_array($store['options'] ?? null)) $store['options'] = [];
        $idx = null;
        foreach ($store['options'] as $i => $o) if (($o['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Option not found.', 404);
        $opt = $store['options'][$idx];
        if (!empty($opt['saleId'])) return $this->fail('This record is linked to an invoice — its payments cannot be edited here.');
        if (!is_array($opt['payments'] ?? null)) $opt['payments'] = [];
        $pIdx = null;
        foreach ($opt['payments'] as $i => $p) if (($p['id'] ?? null) === $paymentId) { $pIdx = $i; break; }
        if ($pIdx === null) return $this->fail('Payment not found.', 404);
        $body = $request->json()->all();
        if (($body['amount'] ?? null) !== null) {
            $amount = Pos::num($body['amount']);
            if ($amount <= 0) return $this->fail('Payment amount must be greater than 0.');
            $opt['payments'][$pIdx]['amount'] = $amount;
        }
        if (($body['date'] ?? null) !== null) $opt['payments'][$pIdx]['date'] = substr((string) $body['date'], 0, 10);
        if (($body['note'] ?? null) !== null) $opt['payments'][$pIdx]['note'] = Pos::str($body['note']);
        $now = Pos::nowIso();
        $opt['payments'][$pIdx]['updatedAt'] = $now;
        $opt['updatedAt'] = $now;
        $store['options'][$idx] = $opt;
        $this->writeStore($request, $store);
        return response()->json(['payment' => $opt['payments'][$pIdx], 'option' => $opt]);
    }

    public function deletePayment(Request $request, string $id, string $paymentId)
    {
        $store = $this->readStore($request);
        if (!is_array($store['options'] ?? null)) $store['options'] = [];
        $idx = null;
        foreach ($store['options'] as $i => $o) if (($o['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Option not found.', 404);
        $opt = $store['options'][$idx];
        if (!empty($opt['saleId'])) return $this->fail('This record is linked to an invoice — its payments cannot be removed here.');
        if (!is_array($opt['payments'] ?? null)) $opt['payments'] = [];
        $before = count($opt['payments']);
        $opt['payments'] = array_values(array_filter($opt['payments'], fn ($p) => ($p['id'] ?? null) !== $paymentId));
        if (count($opt['payments']) === $before) return $this->fail('Payment not found.', 404);
        $opt['updatedAt'] = Pos::nowIso();
        $store['options'][$idx] = $opt;
        $this->writeStore($request, $store);
        return response()->json(['ok' => true]);
    }
}
