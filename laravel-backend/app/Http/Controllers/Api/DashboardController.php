<?php

namespace App\Http\Controllers\Api;

use App\Services\MetalRates;
use App\Support\Pos;
use App\Support\StoreLogic;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController extends ApiController
{
    /** Single aggregate call for the home screen. */
    public function show(Request $request)
    {
        $store = $this->readStore($request);
        $metals = MetalRates::resolve($store);
        $today = gmdate('Y-m-d');
        $monthStart = substr($today, 0, 8) . '01';

        $sales = array_values(array_filter($store['sales'] ?? [], fn ($s) => ($s['status'] ?? '') !== 'voided'));
        // Opening-balance dues (type 'opening_due') owe money but are not revenue.
        $revenueSales = array_values(array_filter($sales, fn ($s) => ($s['type'] ?? null) !== 'opening_due'));
        $sumTotals = fn (array $list) => array_sum(array_map(fn ($s) => Pos::num($s['total'] ?? 0), $list));
        $todaySales = array_values(array_filter($revenueSales, fn ($s) => substr((string) ($s['createdAt'] ?? ''), 0, 10) === $today));
        $monthSales = array_values(array_filter($revenueSales, fn ($s) => substr((string) ($s['createdAt'] ?? ''), 0, 10) >= $monthStart));

        $salesByDay = [];
        for ($i = 0; $i < 7; $i++) {
            $d = gmdate('Y-m-d', time() - (6 - $i) * 86400);
            $daySales = array_values(array_filter($revenueSales, fn ($s) => substr((string) ($s['createdAt'] ?? ''), 0, 10) === $d));
            $salesByDay[] = ['date' => $d, 'amount' => $sumTotals($daySales), 'count' => count($daySales)];
        }

        $outstandingTotal = array_sum(array_map([Pos::class, 'saleDueRemaining'], $sales));
        $openDues = [];
        foreach ($sales as $s) {
            if (Pos::saleDueRemaining($s) <= 0) continue;
            $openDues[] = [
                'id' => $s['id'], 'invoiceNumber' => $s['invoiceNumber'], 'customerName' => $s['customerName'],
                'dueRemaining' => Pos::saleDueRemaining($s), 'createdAt' => $s['createdAt'],
            ];
            if (count($openDues) >= 6) break;
        }

        $inStock = array_values(array_filter($store['items'], fn ($i) => ($i['status'] ?? '') === 'in_stock' && ($i['quantity'] ?? 0) > 0));
        $inventoryValue = 0;
        $totalWeightGrams = 0;
        $itemCount = 0;
        foreach ($inStock as $i) {
            $inventoryValue += Pos::itemValue($i, $metals) * $i['quantity'];
            $totalWeightGrams += Pos::num($i['weightGrams'] ?? 0) * $i['quantity'];
            $itemCount += $i['quantity'];
        }
        $lowStockCount = count(array_filter($store['items'], fn ($i) => ($i['status'] ?? '') === 'in_stock' && ($i['quantity'] ?? 0) <= 1));

        $pendingOrders = count(array_filter($store['orders'] ?? [], fn ($o) => in_array($o['status'] ?? '', ['pending', 'confirmed', 'progress', 'ready'], true)));
        $activeRepairs = count(array_filter($store['repairs'] ?? [], fn ($r) => in_array($r['status'] ?? '', ['received', 'in_progress', 'ready'], true)));
        $activeSchemes = count(array_filter($store['schemes'] ?? [], fn ($s) => in_array($s['status'] ?? '', ['active', 'matured'], true)));

        $recentSales = array_map(fn ($s) => [
            'id' => $s['id'], 'invoiceNumber' => $s['invoiceNumber'], 'customerName' => $s['customerName'],
            'total' => $s['total'] ?? 0, 'method' => $s['payment']['method'] ?? 'cash',
            'dueRemaining' => Pos::saleDueRemaining($s), 'createdAt' => $s['createdAt'],
        ], array_slice($sales, 0, 6));

        return response()->json([
            'date' => $today,
            'goldRatePerTola' => Pos::num($metals['goldRatePerTola'] ?? 0),
            'silverRatePerTola' => Pos::num($metals['silverRatePerTola'] ?? 0),
            'metalRatesLive' => !empty($metals['live']),
            'today' => ['revenue' => $sumTotals($todaySales), 'count' => count($todaySales)],
            'month' => ['revenue' => $sumTotals($monthSales), 'count' => count($monthSales)],
            'salesByDay' => $salesByDay,
            'outstandingTotal' => $outstandingTotal, 'openDues' => $openDues,
            'inventory' => [
                'value' => $inventoryValue, 'items' => $itemCount,
                'weightGrams' => Pos::round2($totalWeightGrams), 'lowStockCount' => $lowStockCount,
            ],
            'pendingOrders' => $pendingOrders, 'activeRepairs' => $activeRepairs, 'activeSchemes' => $activeSchemes,
            'recentSales' => $recentSales,
        ]);
    }

    public function reports(Request $request)
    {
        $start = $request->query('start') ? substr((string) $request->query('start'), 0, 10) : null;
        $end = $request->query('end') ? substr((string) $request->query('end'), 0, 10) : null;
        $store = $this->readStore($request);
        return response()->json(StoreLogic::buildReports($store, $start, $end));
    }

    public function health(Request $request)
    {
        $database = ['ok' => false, 'valid' => true];
        try {
            DB::select('select 1');
            $database['ok'] = true;
            $database['driver'] = DB::connection()->getDriverName();
        } catch (\Throwable $err) {
            $database['error'] = $err->getMessage();
        }
        $metalRates = ['configured' => MetalRates::isConfigured(), 'provider' => MetalRates::getProvider()];
        if ($metalRates['configured']) {
            try {
                $live = MetalRates::getLiveRates('USD');
                $metalRates['ok'] = true;
                $metalRates['source'] = $live['source'] ?? null;
                $metalRates['updatedAt'] = $live['updatedAt'] ?? null;
            } catch (\Throwable $err) {
                $metalRates['ok'] = false;
                $metalRates['error'] = $err->getMessage();
            }
        } else {
            $metalRates['ok'] = false;
            $metalRates['error'] = 'METAL_PRICE_PROVIDER not configured';
        }
        return response()->json([
            'ok' => $database['ok'] && $metalRates['ok'] !== false,
            'dataSource' => 'MySQL (' . config('database.default') . ')',
            'database' => $database,
            'metalRates' => $metalRates,
        ]);
    }
}
