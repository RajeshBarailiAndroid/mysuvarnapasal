<?php

namespace App\Http\Controllers\Api;

use App\Support\Pos;
use App\Support\StoreLogic;
use Illuminate\Http\Request;

class RepairController extends ApiController
{
    public const STATUSES = ['received', 'in_progress', 'ready', 'delivered', 'cancelled'];

    public function index(Request $request)
    {
        $store = $this->readStore($request);
        $repairs = $store['repairs'] ?? [];
        if ($request->query('status')) {
            $repairs = array_values(array_filter($repairs, fn ($r) => ($r['status'] ?? '') === $request->query('status')));
        }
        usort($repairs, fn ($a, $b) => strcmp($b['createdAt'] ?? '', $a['createdAt'] ?? ''));
        return response()->json(['repairs' => $repairs]);
    }

    public function store_(Request $request)
    {
        $store = $this->readStore($request);
        if (!is_array($store['repairs'] ?? null)) $store['repairs'] = [];
        $body = $request->json()->all();
        $customerName = Pos::str($body['customerName'] ?? '');
        $itemDescription = Pos::str($body['itemDescription'] ?? '');
        if ($customerName === '') return $this->fail('Customer name is required.');
        if ($itemDescription === '') return $this->fail('Item description is required.');
        $now = Pos::nowIso();
        $repair = [
            'id' => Pos::newId('rep'), 'repairNumber' => StoreLogic::nextRepairNumber($store), 'status' => 'received',
            'customerName' => $customerName, 'customerPhone' => Pos::str($body['customerPhone'] ?? ''),
            'itemDescription' => $itemDescription,
            'estimatedCharge' => max(0, Pos::num($body['estimatedCharge'] ?? 0)),
            'finalCharge' => null, 'weightGrams' => Pos::num($body['weightGrams'] ?? 0),
            'wastageGrams' => max(0, Pos::num($body['wastageGrams'] ?? 0)),
            'karigarId' => Pos::str($body['karigarId'] ?? '') ?: null,
            'karigarName' => Pos::str($body['karigarName'] ?? ''),
            'promisedDate' => Pos::str($body['promisedDate'] ?? ''),
            'notes' => Pos::str($body['notes'] ?? ''),
            'deliveredAt' => null, 'paymentMethod' => null,
            'createdAt' => $now, 'updatedAt' => $now,
        ];
        array_unshift($store['repairs'], $repair);
        StoreLogic::upsertCustomerInStore($store, ['name' => $customerName, 'phone' => $repair['customerPhone']]);
        $this->writeStore($request, $store);
        return response()->json($repair, 201);
    }

    public function update(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $idx = null;
        foreach (($store['repairs'] ?? []) as $i => $r) if (($r['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Repair not found.', 404);
        $repair = $store['repairs'][$idx];
        if (($repair['status'] ?? '') === 'delivered') return $this->fail('Delivered repairs cannot be changed.');
        $body = $request->json()->all();
        $now = Pos::nowIso();
        if (($body['status'] ?? null) !== null) {
            $nextStatus = (string) $body['status'];
            if (!in_array($nextStatus, self::STATUSES, true)) return $this->fail('Invalid repair status.');
            if ($nextStatus === 'delivered') {
                $charge = (($body['finalCharge'] ?? null) !== null && ($body['finalCharge'] ?? null) !== '')
                    ? max(0, Pos::num($body['finalCharge']))
                    : max(0, Pos::num($repair['estimatedCharge'] ?? 0));
                $method = in_array($body['paymentMethod'] ?? null, Pos::PAYMENT_METHODS, true) ? $body['paymentMethod'] : 'cash';
                $repair['finalCharge'] = $charge;
                $repair['paymentMethod'] = $method;
                $repair['deliveredAt'] = $now;
                if ($charge > 0) {
                    array_unshift($store['transactions'], [
                        'id' => Pos::newId('tx'), 'type' => 'sale', 'itemId' => null,
                        'itemName' => mb_substr("Repair {$repair['repairNumber']} — {$repair['itemDescription']}", 0, 120),
                        'quantity' => 1, 'amount' => $charge,
                        'note' => "Repair {$repair['repairNumber']} — {$repair['customerName']} · {$method}",
                        'createdAt' => $now,
                    ]);
                }
            }
            $repair['status'] = $nextStatus;
        }
        if (($body['customerName'] ?? null) !== null) $repair['customerName'] = Pos::str($body['customerName']) ?: $repair['customerName'];
        if (($body['customerPhone'] ?? null) !== null) $repair['customerPhone'] = Pos::str($body['customerPhone']);
        if (($body['itemDescription'] ?? null) !== null) $repair['itemDescription'] = Pos::str($body['itemDescription']) ?: $repair['itemDescription'];
        if (($body['estimatedCharge'] ?? null) !== null) $repair['estimatedCharge'] = max(0, Pos::num($body['estimatedCharge']));
        if (($body['weightGrams'] ?? null) !== null) $repair['weightGrams'] = Pos::num($body['weightGrams']);
        if (($body['wastageGrams'] ?? null) !== null) $repair['wastageGrams'] = max(0, Pos::num($body['wastageGrams']));
        if (array_key_exists('karigarId', $body)) $repair['karigarId'] = Pos::str($body['karigarId'] ?? '') ?: null;
        if (($body['karigarName'] ?? null) !== null) $repair['karigarName'] = Pos::str($body['karigarName']);
        if (($body['promisedDate'] ?? null) !== null) $repair['promisedDate'] = Pos::str($body['promisedDate']);
        if (($body['notes'] ?? null) !== null) $repair['notes'] = Pos::str($body['notes']);
        $repair['updatedAt'] = $now;
        $store['repairs'][$idx] = $repair;
        $this->writeStore($request, $store);
        return response()->json($repair);
    }

    public function destroy(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $repair = null;
        foreach (($store['repairs'] ?? []) as $r) if (($r['id'] ?? null) === $id) { $repair = $r; break; }
        if (!$repair) return $this->fail('Repair not found.', 404);
        if (($repair['status'] ?? '') !== 'cancelled') return $this->fail('Only cancelled repairs can be deleted. Cancel it first.');
        $store['repairs'] = array_values(array_filter($store['repairs'], fn ($r) => ($r['id'] ?? null) !== $id));
        $this->writeStore($request, $store);
        return response()->json(['ok' => true]);
    }
}
