<?php

namespace App\Http\Controllers\Api;

use App\Services\GoldPriceHistory;
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
            // The provider's raw error is logged, not returned: it names the
            // upstream host and sometimes the request that failed.
            \Illuminate\Support\Facades\Log::warning('metal-rates: ' . $err->getMessage());
            return $this->fail('Could not fetch live metal rates right now.', 502);
        }
    }

    /**
     * The shared row holds only the MARKET (api-mode) feed now. Each shop's
     * own manual rate history lives in its settings and is never shared, so
     * `priceMode=manual` here answers with nothing rather than with every
     * shop's private selling rate.
     */
    public function sharedGoldRates(Request $request)
    {
        $date = substr((string) ($request->query('date') ?: gmdate('Y-m-d')), 0, 10);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) $date = gmdate('Y-m-d');
        if ($request->query('priceMode') !== 'api') return response()->json(['ticks' => [], 'history' => []]);
        return response()->json(SharedRates::getForClient($date, 'api'));
    }

    /**
     * Only the administrator (or the cron job, via cronCapture) may write to
     * the shared feed. Any shop used to be able to POST unlimited ticks with
     * arbitrary dates — and with `saved:true` they were kept forever — which
     * both polluted every other shop's chart and made a cheap DoS.
     */
    public function appendTicks(Request $request)
    {
        $user = $request->attributes->get('authUser');
        if (!$user || !$user->is_admin) return $this->fail('Not found.', 404);
        $body = $request->json()->all();
        $ticks = is_array($body['ticks'] ?? null) ? $body['ticks'] : [];
        if (count($ticks) > 200) return $this->fail('Too many ticks in one request (max 200).');
        foreach ($ticks as $t) {
            if (!is_array($t)) return $this->fail('Each tick must be an object.');
            $rate = Pos::numOrNull($t['goldRatePerTola'] ?? null);
            if ($rate === null || $rate <= 0 || !is_finite($rate)) return $this->fail('Each tick needs a positive goldRatePerTola.');
            $t['priceMode'] = 'api';
        }
        $result = SharedRates::appendTicks($ticks);
        return response()->json(['ok' => true, 'count' => $result['count']]);
    }

    public function cronCapture(Request $request)
    {
        $secret = trim((string) env('CRON_SECRET', ''));
        $auth = (string) $request->header('Authorization', '');
        $headerSecret = (string) $request->header('x-cron-secret', '');
        $authorized = $secret !== '' && (hash_equals("Bearer {$secret}", $auth) || hash_equals($secret, $headerSecret));
        if (!$authorized) return $this->fail('Cron secret required.', 401);
        // The shared market-price history (gold_price_ticks) is the one the
        // charts read; the legacy shared_gold_rates blob is kept in step.
        try {
            $tick = GoldPriceHistory::capture();
        } catch (\Throwable $err) {
            return $this->fail($err->getMessage() ?: 'Could not fetch the live gold price.', 502);
        }
        $result = SharedRates::captureIfChanged(['currency' => $request->query('currency')]);
        $result['tick'] = $tick;
        return response()->json($result);
    }
}
