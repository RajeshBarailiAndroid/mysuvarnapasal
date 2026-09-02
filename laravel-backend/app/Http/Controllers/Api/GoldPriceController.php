<?php

namespace App\Http\Controllers\Api;

use App\Services\GoldPriceHistory;
use App\Services\MetalRates;
use Illuminate\Http\Request;

/**
 * The market gold price and its history. Global, read-only, no shop data —
 * every shop and every phone sees the same chart.
 */
class GoldPriceController extends ApiController
{
    /** GET /api/gold-price?range=24h|week|month|6m */
    public function show(Request $request)
    {
        if (!MetalRates::isConfigured()) {
            return response()->json(['error' => 'Live metal API is not configured.', 'configured' => false], 503);
        }
        GoldPriceHistory::captureIfStale();
        $payload = GoldPriceHistory::series((string) $request->query('range', '24h'));
        $payload['configured'] = true;
        return response()->json($payload);
    }

    /** GET /api/gold-price/latest — the newest reading only. */
    public function latest()
    {
        if (!MetalRates::isConfigured()) {
            return response()->json(['error' => 'Live metal API is not configured.', 'configured' => false], 503);
        }
        GoldPriceHistory::captureIfStale();
        return response()->json(['configured' => true, 'latest' => GoldPriceHistory::latest()]);
    }
}
