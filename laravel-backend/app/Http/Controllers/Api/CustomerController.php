<?php

namespace App\Http\Controllers\Api;

use App\Support\Pos;
use App\Support\StoreLogic;
use Illuminate\Http\Request;

class CustomerController extends ApiController
{
    public function index(Request $request)
    {
        $store = $this->readStore($request);
        $changed = StoreLogic::syncCustomersFromOrders($store);
        if ($changed) $this->writeStore($request, $store);
        return response()->json(['customers' => StoreLogic::listCustomersWithActivity($store)]);
    }

    public function store_(Request $request)
    {
        $store = $this->readStore($request);
        $body = $request->json()->all();
        $name = Pos::str($body['name'] ?? '');
        if ($name === '') return $this->fail('Customer name is required.');
        $phone = Pos::str($body['phone'] ?? '');
        $phoneError = Pos::validateCustomerPhone($phone, $body['phoneRegion'] ?? null);
        if ($phoneError) return $this->fail($phoneError);
        $customer = StoreLogic::upsertCustomerInStore($store, $body);
        $this->writeStore($request, $store);
        $purchaseCounts = StoreLogic::computeCustomerPurchaseCounts($store);
        $customer['purchases'] = $purchaseCounts[Pos::customerMatchKey($customer['name'], $customer['phone'])] ?? 0;
        return response()->json([
            'customer' => $customer,
            'customers' => StoreLogic::listCustomersWithActivity($store),
        ], 201);
    }

    public function upsert(Request $request)
    {
        $store = $this->readStore($request);
        $body = $request->json()->all();
        $phone = Pos::str($body['phone'] ?? '');
        $phoneError = Pos::validateCustomerPhone($phone, $body['phoneRegion'] ?? null);
        if ($phoneError) return $this->fail($phoneError);
        $customer = StoreLogic::upsertCustomerInStore($store, $body);
        if (!$customer) return $this->fail('Customer name is required.');
        $this->writeStore($request, $store);
        return response()->json([
            'customer' => $customer,
            'customers' => StoreLogic::listCustomersWithActivity($store),
        ]);
    }

    public function destroy(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $before = count($store['customers'] ?? []);
        $store['customers'] = array_values(array_filter($store['customers'] ?? [], fn ($c) => ($c['id'] ?? null) !== $id));
        if (count($store['customers']) === $before) return $this->fail('Customer not found.', 404);
        $this->writeStore($request, $store);
        return response()->json(['customers' => StoreLogic::listCustomersWithActivity($store)]);
    }
}
