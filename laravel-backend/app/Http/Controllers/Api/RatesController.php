<?php

namespace App\Http\Controllers\Api;

use App\Services\MetalRates;
use App\Services\SharedRates;
use App\Support\Pos;
use Illuminate\Http\Request;

class RatesController extends ApiController
{
    public function metalRates(Request $request)
    {
        if (!MetalRates::isConfigured()) return $this->fail('Live metal API is not configured.', 503);
        try {
            $currency = MetalRates::normalizeMetalCurrency((string) $request->query('currency', 'USD'));
            $rates = MetalRates::getLiveRates($currency);
            $tolaNpr = SharedRates::displayToNpr($rates['gold']['perTola'] ?? 0, $currency);
            $gramNpr = SharedRates::displayToNpr($rates['gold']['perGram'] ?? 0, $currency)
                ?: Pos::round2($tolaNpr / Pos::TOLA_GRAMS);
            if ($tolaNpr > 0) {
                try {
                    SharedRates::appendHistory([
                        'goldRatePerTola' => $tolaNpr, 'goldRatePerGram' => $gramNpr,
                        'priceMode' => 'api', 'localDate' => SharedRates::localDateStr(),
                    ]);
                } catch (\Throwable $err) {
                    // History save is best-effort (matches the Express behaviour).
                }
            }
            return response()->json($rates);
        } catch (\Throwable $err) {
            return $this->fail($err->getMessage() ?: 'Could not fetch live metal rates.', 502);
        }
    }

    public function sharedGoldRates(Request $request)
    {
        $date = substr((string) ($request->query('date') ?: gmdate('Y-m-d')), 0, 10);
        $priceMode = $request->query('priceMode') === 'api' ? 'api' : 'manual';
        return response()->json(SharedRates::getForClient($date, $priceMode));
    }

    public function appendTicks(Request $request)
    {
        $body = $request->json()->all();
        $ticks = is_array($body['ticks'] ?? null) ? $body['ticks'] : [];
        $result = SharedRates::appendTicks($ticks);
        return response()->json(['ok' => true, 'count' => $result['count']]);
    }

    public function cronCapture(Request $request)
    {
        $secret = trim((string) env('CRON_SECRET', ''));
        $auth = (string) $request->header('Authorization', '');
        $headerSecret = (string) $request->header('x-cron-secret', '');
        $authorized = $secret !== '' && ($auth === "Bearer {$secret}" || $headerSecret === $secret);
        if (!$authorized) return $this->fail('Cron secret required.', 401);
        $result = SharedRates::captureIfChanged(['currency' => $request->query('currency')]);
        return response()->json($result);
    }
}
