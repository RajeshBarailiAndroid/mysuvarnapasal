<?php

namespace App\Services;

use App\Support\Pos;
use Illuminate\Support\Facades\Cache;

/**
 * Live gold/silver spot rates (ported from lib/metal-rates.ts).
 * Providers: gold-api.com (default, free), goldapi.io, metals-api.
 * Results are cached for 5 minutes per currency.
 */
class MetalRates
{
    public const TROY_OZ_GRAMS = 31.1034768;
    public const CACHE_SECONDS = 5 * 60;
    public const METAL_CURRENCIES = ['USD', 'CAD'];

    public static function normalizeMetalCurrency($currency): string
    {
        $code = strtoupper(Pos::str($currency) ?: 'USD');
        if ($code === 'NPR') return 'USD';
        return in_array($code, self::METAL_CURRENCIES, true) ? $code : 'USD';
    }

    public static function getProvider(): string
    {
        return strtolower((string) env('METAL_PRICE_PROVIDER', 'gold-api'));
    }

    private static function getApiKey(): string
    {
        return trim((string) (env('METAL_PRICE_API_KEY') ?: env('GOLD_API_KEY') ?: ''));
    }

    public static function hasValidApiKey(): bool
    {
        $key = self::getApiKey();
        return $key !== '' && !str_contains($key, 'your-') && $key !== 'your-api-key' && $key !== 'your-goldapi-key';
    }

    private static function usesGoldApiCom(): bool
    {
        $provider = self::getProvider();
        return $provider === 'gold-api' || $provider === 'gold-api.com';
    }

    public static function isConfigured(): bool
    {
        $provider = self::getProvider();
        if (self::usesGoldApiCom()) return true;
        if (in_array($provider, ['metals-api', 'goldapi', 'goldapi.io'], true)) return self::hasValidApiKey();
        return true;
    }

    private static function round($value, int $digits): float
    {
        $n = Pos::numOrNull($value);
        return $n === null ? 0 : round($n, $digits);
    }

    private static function buildMetalQuote(float $usdPerOz): array
    {
        $perGram = $usdPerOz / self::TROY_OZ_GRAMS;
        $perTola = $perGram * Pos::TOLA_GRAMS;
        return ['perOz' => self::round($usdPerOz, 2), 'perGram' => self::round($perGram, 4), 'perTola' => self::round($perTola, 2)];
    }

    private static function goldApiTimestamp($value): string
    {
        if (!$value) return Pos::nowIso();
        if (is_numeric($value)) {
            $n = (float) $value;
            $ms = $n > 1e12 ? $n : $n * 1000;
            return gmdate('Y-m-d\TH:i:s', (int) ($ms / 1000)) . '.000Z';
        }
        return (string) $value;
    }

    /** Small JSON fetcher using PHP curl (no extra Composer dependency). */
    private static function fetchJson(string $url, array $headers = [], int $timeoutMs = 15000): array
    {
        $ch = curl_init($url);
        $headerLines = ['Accept: application/json', 'User-Agent: SubarnaPasal/1.0'];
        foreach ($headers as $k => $v) $headerLines[] = "$k: $v";
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT_MS => $timeoutMs,
            CURLOPT_HTTPHEADER => $headerLines,
        ]);
        $body = curl_exec($ch);
        $errno = curl_errno($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($errno === CURLE_OPERATION_TIMEDOUT) {
            throw new \RuntimeException('Metal price API timed out. Try again in a moment.');
        }
        if ($errno) throw new \RuntimeException('Metal price API request failed: ' . curl_strerror($errno));
        $data = json_decode((string) $body, true);
        if (!is_array($data)) $data = [];
        if ($status < 200 || $status >= 300) {
            $message = $data['error'] ?? $data['message'] ?? $data['detail'] ?? null;
            throw new \RuntimeException($message ?: "Metal API request failed ($status)");
        }
        return $data;
    }

    private static function fetchFromGoldApiCom(string $currency = 'USD'): array
    {
        $code = self::normalizeMetalCurrency($currency);
        $gold = self::fetchJson("https://api.gold-api.com/price/XAU/{$code}");
        $silver = self::fetchJson("https://api.gold-api.com/price/XAG/{$code}");
        $goldOz = Pos::numOrNull($gold['price'] ?? null);
        $silverOz = Pos::numOrNull($silver['price'] ?? null);
        if ($goldOz === null || $silverOz === null) throw new \RuntimeException('gold-api.com returned invalid prices.');
        return [
            'currency' => $gold['currency'] ?? $silver['currency'] ?? 'USD',
            'source' => 'gold-api.com',
            'updatedAt' => $gold['updatedAt'] ?? $silver['updatedAt'] ?? Pos::nowIso(),
            'gold' => self::buildMetalQuote($goldOz),
            'silver' => self::buildMetalQuote($silverOz),
        ];
    }

    private static function buildMetalQuoteFromGoldApiIo(array $payload): array
    {
        $perOz = Pos::numOrNull($payload['price'] ?? null);
        if ($perOz === null || $perOz <= 0) throw new \RuntimeException('GoldAPI.io returned invalid spot price.');
        $perGram24k = Pos::numOrNull($payload['price_gram_24k'] ?? null);
        $perGram = ($perGram24k !== null && $perGram24k > 0) ? $perGram24k : $perOz / self::TROY_OZ_GRAMS;
        $perTola = $perGram * Pos::TOLA_GRAMS;
        $quote = [
            'perOz' => self::round($perOz, 2), 'perGram' => self::round($perGram, 4), 'perTola' => self::round($perTola, 2),
            'bid' => isset($payload['bid']) ? self::round($payload['bid'], 2) : null,
            'ask' => isset($payload['ask']) ? self::round($payload['ask'], 2) : null,
        ];
        if (isset($payload['price_gram_22k'])) {
            $quote['karatPerGram'] = [
                'k24' => self::round($payload['price_gram_24k'] ?? 0, 4), 'k22' => self::round($payload['price_gram_22k'], 4),
                'k21' => self::round($payload['price_gram_21k'] ?? 0, 4), 'k20' => self::round($payload['price_gram_20k'] ?? 0, 4),
                'k18' => self::round($payload['price_gram_18k'] ?? 0, 4),
            ];
        }
        return $quote;
    }

    private static function fetchFromGoldApiIo(): array
    {
        $headers = ['x-access-token' => self::getApiKey()];
        $gold = self::fetchJson('https://www.goldapi.io/api/XAU/USD', $headers);
        $silver = self::fetchJson('https://www.goldapi.io/api/XAG/USD', $headers);
        return [
            'currency' => 'USD', 'source' => 'goldapi.io',
            'exchange' => $gold['exchange'] ?? $silver['exchange'] ?? null,
            'updatedAt' => self::goldApiTimestamp($gold['timestamp'] ?? $silver['timestamp'] ?? null),
            'gold' => self::buildMetalQuoteFromGoldApiIo($gold),
            'silver' => self::buildMetalQuoteFromGoldApiIo($silver),
        ];
    }

    private static function fetchFromMetalsApi(): array
    {
        $url = 'https://metals-api.com/api/latest?' . http_build_query([
            'access_key' => self::getApiKey(), 'base' => 'USD', 'symbols' => 'XAU,XAG',
        ]);
        $data = self::fetchJson($url);
        $goldRate = Pos::numOrNull($data['rates']['XAU'] ?? null);
        $silverRate = Pos::numOrNull($data['rates']['XAG'] ?? null);
        if ($goldRate === null || $silverRate === null || $goldRate <= 0 || $silverRate <= 0) {
            throw new \RuntimeException('Metals-API returned invalid prices.');
        }
        return [
            'currency' => 'USD', 'source' => 'metals-api',
            'updatedAt' => isset($data['timestamp']) ? gmdate('Y-m-d\TH:i:s', (int) $data['timestamp']) . '.000Z' : Pos::nowIso(),
            'gold' => self::buildMetalQuote(1 / $goldRate),
            'silver' => self::buildMetalQuote(1 / $silverRate),
        ];
    }

    public static function getLiveRates($currency = 'USD'): array
    {
        if (!self::isConfigured()) throw new \RuntimeException('Live metal API is not configured.');
        $code = self::normalizeMetalCurrency($currency);
        $cacheKey = "metal-rates:{$code}";
        $cached = Cache::get($cacheKey);
        if (is_array($cached)) return $cached;
        $provider = self::getProvider();
        if ($provider === 'metals-api' && self::hasValidApiKey()) $data = self::fetchFromMetalsApi();
        elseif (in_array($provider, ['goldapi', 'goldapi.io'], true) && self::hasValidApiKey()) $data = self::fetchFromGoldApiIo();
        else $data = self::fetchFromGoldApiCom($code);
        Cache::put($cacheKey, $data, self::CACHE_SECONDS);
        return $data;
    }

    /**
     * Resolve the metal rates a request should use: manual settings rates, or
     * live API rates converted to NPR when priceMode is 'api'.
     * Ported from resolveMetalRates in routes/api.ts.
     */
    public static function resolve(array $store): array
    {
        $settings = $store['settings'];
        $goldPerTola = Pos::num($settings['goldRatePerTola'] ?? 0);
        $manual = [
            'live' => false, 'currency' => null,
            'goldRatePerTola' => $settings['goldRatePerTola'] ?? 0,
            'goldRatePerGram' => ($settings['goldRatePerGram'] ?? null) !== null && $settings['goldRatePerGram'] !== ''
                ? $settings['goldRatePerGram']
                : Pos::round2($goldPerTola / Pos::TOLA_GRAMS),
            'silverRatePerTola' => $settings['silverRatePerTola'] ?? 0,
            'silverRatePerGram' => $settings['silverRatePerGram'] ?? 0,
            'fx' => ['currency' => 'NPR', 'nprPerUnit' => 1, 'updatedAt' => $settings['fxUpdatedAt'] ?? null],
        ];
        // Live/API metal pricing was removed: every screen and every bill uses
        // the rate the shop saved in Settings. Kept below for reference only.
        return $manual;
        // @phpstan-ignore-next-line deadCode.unreachable
        if (($settings['priceMode'] ?? 'manual') !== 'api' || !self::isConfigured()) return $manual;
        try {
            $metalCurrency = self::normalizeMetalCurrency($settings['currency'] ?? 'USD');
            $live = self::getLiveRates($metalCurrency);
            $rateCurrency = $live['currency'] ?? $metalCurrency;
            $toNprFactor = Pos::fxNprPerUnit($settings, $rateCurrency);
            return [
                'live' => true, 'currency' => $rateCurrency,
                'source' => $live['source'] ?? null, 'updatedAt' => $live['updatedAt'] ?? null,
                'goldRatePerTola' => ($live['gold']['perTola'] ?? 0) * $toNprFactor,
                'goldRatePerGram' => ($live['gold']['perGram'] ?? 0) * $toNprFactor,
                'silverRatePerTola' => ($live['silver']['perTola'] ?? 0) * $toNprFactor,
                'silverRatePerGram' => ($live['silver']['perGram'] ?? 0) * $toNprFactor,
                'fx' => ['currency' => $rateCurrency, 'nprPerUnit' => $toNprFactor, 'updatedAt' => $settings['fxUpdatedAt'] ?? null],
            ];
        } catch (\Throwable $err) {
            $manual['liveError'] = $err->getMessage();
            return $manual;
        }
    }
}
