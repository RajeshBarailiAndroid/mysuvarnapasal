<?php

namespace App\Http\Controllers\Api;

use App\Support\Pos;
use App\Support\StoreLogic;
use Illuminate\Http\Request;

class OldGoldController extends ApiController
{
    public function index(Request $request)
    {
        $store = $this->readStore($request);
        $exchanges = $store['oldGoldExchanges'] ?? [];
        usort($exchanges, fn ($a, $b) => strcmp($b['createdAt'] ?? '', $a['createdAt'] ?? ''));
        return response()->json(['exchanges' => $exchanges]);
    }

    public function store_(Request $request)
    {
        $store = $this->readStore($request);
        if (!is_array($store['oldGoldExchanges'] ?? null)) $store['oldGoldExchanges'] = [];
        $body = $request->json()->all();
        $customerName = Pos::str($body['customerName'] ?? '');
        $weightGrams = Pos::num($body['weightGrams'] ?? 0);
        $karat = Pos::num($body['karat'] ?? 0) ?: 22;
        $ratePerTola = Pos::num($body['ratePerTola'] ?? 0);
        if ($customerName === '') return $this->fail('Customer name is required.');
        if ($weightGrams <= 0) return $this->fail('Weight must be greater than 0.');
        $tola = $weightGrams / Pos::TOLA_GRAMS;
        $purityFactor = $karat / 24;
        $buyValue = (int) round($tola * $ratePerTola * $purityFactor);
        $now = Pos::nowIso();
        $exchange = [
            'id' => Pos::newId('og'), 'customerName' => $customerName,
            'customerPhone' => Pos::str($body['customerPhone'] ?? ''),
            'weightGrams' => $weightGrams, 'karat' => $karat, 'ratePerTola' => $ratePerTola,
            'buyValue' => $buyValue,
            'description' => Pos::str($body['description'] ?? ''),
            'date' => Pos::str($body['date'] ?? '') ?: substr($now, 0, 10), 'createdAt' => $now,
        ];
        array_unshift($store['oldGoldExchanges'], $exchange);
        StoreLogic::upsertCustomerInStore($store, ['name' => $customerName, 'phone' => $exchange['customerPhone']]);
        $this->writeStore($request, $store);
        return response()->json($exchange, 201);
    }

    public function destroy(Request $request, string $id)
    {
        $store = $this->readStore($request);
        if (!is_array($store['oldGoldExchanges'] ?? null)) $store['oldGoldExchanges'] = [];
        $before = count($store['oldGoldExchanges']);
        $store['oldGoldExchanges'] = array_values(array_filter($store['oldGoldExchanges'], fn ($e) => ($e['id'] ?? null) !== $id));
        if (count($store['oldGoldExchanges']) === $before) return $this->fail('Exchange not found.', 404);
        $this->writeStore($request, $store);
        return response()->json(['ok' => true]);
    }
}
