<?php

namespace App\Http\Controllers\Api;

use App\Support\Pos;
use Illuminate\Http\Request;

class KarigarController extends ApiController
{
    public function index(Request $request)
    {
        $store = $this->readStore($request);
        return response()->json(['karigars' => $store['karigars'] ?? []]);
    }

    public function store_(Request $request)
    {
        $store = $this->readStore($request);
        if (!is_array($store['karigars'] ?? null)) $store['karigars'] = [];
        $body = $request->json()->all();
        $name = Pos::str($body['name'] ?? '');
        if ($name === '') return $this->fail('Karigar name is required.');
        $now = Pos::nowIso();
        $karigar = [
            'id' => Pos::newId('kg'), 'name' => $name, 'phone' => Pos::str($body['phone'] ?? ''),
            'specialty' => Pos::str($body['specialty'] ?? ''),
            'address' => Pos::str($body['address'] ?? ''),
            'notes' => Pos::str($body['notes'] ?? ''),
            'goldIssuedGrams' => 0, 'goldReturnedGrams' => 0, 'goldWastageGrams' => 0,
            'active' => ($body['active'] ?? null) === null ? true : (bool) $body['active'],
            'createdAt' => $now, 'updatedAt' => $now,
        ];
        array_unshift($store['karigars'], $karigar);
        $this->writeStore($request, $store);
        return response()->json($karigar, 201);
    }

    public function update(Request $request, string $id)
    {
        $store = $this->readStore($request);
        if (!is_array($store['karigars'] ?? null)) $store['karigars'] = [];
        $idx = null;
        foreach ($store['karigars'] as $i => $k) if (($k['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Karigar not found.', 404);
        $body = $request->json()->all();
        $karigar = $store['karigars'][$idx];
        if (($body['name'] ?? null) !== null) $karigar['name'] = Pos::str($body['name']);
        if (($body['phone'] ?? null) !== null) $karigar['phone'] = Pos::str($body['phone']);
        if (($body['specialty'] ?? null) !== null) $karigar['specialty'] = Pos::str($body['specialty']);
        if (($body['address'] ?? null) !== null) $karigar['address'] = Pos::str($body['address']);
        if (($body['notes'] ?? null) !== null) $karigar['notes'] = Pos::str($body['notes']);
        if (($body['active'] ?? null) !== null) $karigar['active'] = (bool) $body['active'];
        $karigar['updatedAt'] = Pos::nowIso();
        $store['karigars'][$idx] = $karigar;
        $this->writeStore($request, $store);
        return response()->json($karigar);
    }

    public function destroy(Request $request, string $id)
    {
        $store = $this->readStore($request);
        if (!is_array($store['karigars'] ?? null)) $store['karigars'] = [];
        $before = count($store['karigars']);
        $store['karigars'] = array_values(array_filter($store['karigars'], fn ($k) => ($k['id'] ?? null) !== $id));
        if (count($store['karigars']) === $before) return $this->fail('Karigar not found.', 404);
        $this->writeStore($request, $store);
        return response()->json(['ok' => true]);
    }

    public function issueGold(Request $request, string $id)
    {
        return $this->goldEntry($request, $id, 'issue');
    }

    public function returnGold(Request $request, string $id)
    {
        return $this->goldEntry($request, $id, 'return');
    }

    private function goldEntry(Request $request, string $id, string $type)
    {
        $store = $this->readStore($request);
        if (!is_array($store['karigars'] ?? null)) $store['karigars'] = [];
        $idx = null;
        foreach ($store['karigars'] as $i => $k) if (($k['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Karigar not found.', 404);
        $karigar = $store['karigars'][$idx];
        $body = $request->json()->all();
        $weightGrams = Pos::num($body['weightGrams'] ?? 0);
        $wastageGrams = Pos::num($body['wastageGrams'] ?? 0);
        if ($type === 'issue' && $weightGrams <= 0) return $this->fail('Weight must be greater than 0.');
        if ($type === 'return' && $weightGrams <= 0) return $this->fail('Returned weight must be greater than 0.');
        $now = Pos::nowIso();
        $entry = [
            'id' => Pos::newId('gl'), 'karigarId' => $karigar['id'], 'karigarName' => $karigar['name'],
            'type' => $type, 'weightGrams' => $weightGrams,
            'karat' => Pos::num($body['karat'] ?? 0) ?: 24,
            'description' => Pos::str($body['description'] ?? ''),
            'date' => Pos::str($body['date'] ?? '') ?: substr($now, 0, 10), 'createdAt' => $now,
        ];
        if ($type === 'issue') {
            $karigar['goldIssuedGrams'] = Pos::num($karigar['goldIssuedGrams'] ?? 0) + $weightGrams;
        } else {
            $entry['wastageGrams'] = $wastageGrams;
            $karigar['goldReturnedGrams'] = Pos::num($karigar['goldReturnedGrams'] ?? 0) + $weightGrams;
            $karigar['goldWastageGrams'] = Pos::num($karigar['goldWastageGrams'] ?? 0) + $wastageGrams;
        }
        $karigar['updatedAt'] = $now;
        $store['karigars'][$idx] = $karigar;
        if (!is_array($store['goldLedger'] ?? null)) $store['goldLedger'] = [];
        array_unshift($store['goldLedger'], $entry);
        $this->writeStore($request, $store);
        return response()->json(['entry' => $entry, 'karigar' => $karigar], 201);
    }

    public function goldLedger(Request $request)
    {
        $store = $this->readStore($request);
        $ledger = $store['goldLedger'] ?? [];
        usort($ledger, fn ($a, $b) => strcmp($b['createdAt'] ?? '', $a['createdAt'] ?? ''));
        $karigarId = $request->query('karigarId');
        $filtered = $karigarId
            ? array_values(array_filter($ledger, fn ($e) => ($e['karigarId'] ?? null) === $karigarId))
            : $ledger;
        return response()->json(['entries' => $filtered]);
    }
}
