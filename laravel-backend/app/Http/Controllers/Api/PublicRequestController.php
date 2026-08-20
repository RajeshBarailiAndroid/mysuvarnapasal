<?php

namespace App\Http\Controllers\Api;

use App\Services\MetalRates;
use App\Services\Store;
use App\Support\Pos;
use App\Support\StoreLogic;
use Illuminate\Http\Request as HttpRequest;
use Illuminate\Support\Facades\DB;

/**
 * Public customer request link (no login).
 *
 * The shop shares one unguessable link — /order/{code} — with walk-in
 * customers. The page behind it (public/customer.html) can:
 *
 *   GET  /api/public/{code}/items     read-only, in-stock inventory + rates
 *   GET  /api/public/{code}/requests  the caller's own requests (name+phone must match)
 *   POST /api/public/{code}/requests  file a new "requested item" entry
 *
 * Nothing else is reachable through the code: no sales, no customers, no
 * settings, no cost prices, and no way to read another customer's requests.
 * The shop owner fetches their own link from GET /api/public-link (signed in).
 *
 * The code is derived, not stored: HMAC(userId, PUBLIC_REQUEST_SALT or APP_KEY).
 * That means no migration, and setting PUBLIC_REQUEST_SALT to a new value
 * invalidates every previously shared link at once.
 */
class PublicRequestController extends ApiController
{
    /** Item fields a customer is allowed to see (cost, location and notes are not). */
    private const PUBLIC_ITEM_FIELDS = [
        'id', 'itemNumber', 'sku', 'name', 'category', 'karat', 'weightGrams',
        'weightUnit', 'makingCharge', 'jartiRateType', 'jartiRateValue',
        'salePrice', 'customRatePerTola', 'stoneAmount', 'quantity', 'status', 'hallmark',
    ];

    private const MAX_ITEMS_PER_REQUEST = 25;

    // ── code <-> shop ────────────────────────────────────────────────────────

    public static function codeFor(string $userId): string
    {
        // config(), not env(), so the value survives `php artisan config:cache`.
        $salt = (string) config('app.public_request_salt', '');
        $key = $salt !== '' ? $salt : (string) config('app.key');
        return substr(hash_hmac('sha256', 'subarnapasal-public-request:' . $userId, $key), 0, 20);
    }

    private function resolveUserId(string $code): ?string
    {
        $code = strtolower(preg_replace('/[^0-9a-fA-F]/', '', $code));
        if ($code === '') return null;

        $candidates = [Store::LOCAL_DEV_USER_ID];
        foreach (DB::table('users')->pluck('id') as $id) {
            $candidates[] = (string) $id;
        }
        foreach ($candidates as $userId) {
            if (hash_equals(self::codeFor($userId), $code)) return $userId;
        }
        return null;
    }

    /** 404 for a bad code — a wrong link must not reveal whether a shop exists. */
    private function shopOr404(string $code)
    {
        $userId = $this->resolveUserId($code);
        if ($userId === null) return null;
        return $userId;
    }

    private function publicItem(array $item): array
    {
        $out = [];
        foreach (self::PUBLIC_ITEM_FIELDS as $field) {
            if (array_key_exists($field, $item)) $out[$field] = $item[$field];
        }
        return $out;
    }

    /** Unit the available quantity is counted in, e.g. "piece (10.5 g each)". */
    private static function unitLabel(array $item): string
    {
        $grams = Pos::num($item['weightGrams'] ?? 0);
        $weightUnit = strtolower(Pos::str($item['weightUnit'] ?? ''));
        if ($grams > 0 && $weightUnit === 'tola') {
            return 'piece (' . rtrim(rtrim(number_format($grams / Pos::TOLA_GRAMS, 3, '.', ''), '0'), '.') . ' tola each)';
        }
        if ($grams > 0) {
            return 'piece (' . rtrim(rtrim(number_format($grams, 3, '.', ''), '0'), '.') . ' g each)';
        }
        return 'piece';
    }

    private function isAvailable(array $item): bool
    {
        $status = strtolower(Pos::str($item['status'] ?? ''));
        return Pos::num($item['quantity'] ?? 0) > 0
            && $status !== 'sold'
            && $status !== 'sold_out';
    }

    // ── endpoints ────────────────────────────────────────────────────────────

    /** Read-only inventory for the shared link. */
    public function items(HttpRequest $request, string $code)
    {
        $userId = $this->shopOr404($code);
        if ($userId === null) return $this->fail('This link is not valid.', 404);

        $store = $this->store->read($userId);
        $items = [];
        foreach (($store['items'] ?? []) as $item) {
            if (!is_array($item) || !$this->isAvailable($item)) continue;
            $items[] = $this->publicItem($item);
        }
        usort($items, fn ($a, $b) => strcmp(Pos::str($a['name'] ?? ''), Pos::str($b['name'] ?? '')));

        $metals = MetalRates::resolve($store);
        return response()->json([
            'shopName' => Pos::str($store['settings']['shopName'] ?? '') ?: 'SubarnaPasal',
            'shopPhone' => Pos::str($store['settings']['shopPhone'] ?? ''),
            'currency' => Pos::str($store['settings']['currency'] ?? '') ?: 'NPR',
            'items' => $items,
            'goldRatePerTola' => $metals['goldRatePerTola'],
            'silverRatePerTola' => $metals['silverRatePerTola'],
            'metalRatesLive' => $metals['live'],
            'metalCurrency' => $metals['currency'],
        ]);
    }

    /**
     * The caller's own requests. Both name AND phone must match an entry, so
     * one customer cannot read another's list by guessing a phone number.
     */
    public function mine(HttpRequest $request, string $code)
    {
        $userId = $this->shopOr404($code);
        if ($userId === null) return $this->fail('This link is not valid.', 404);

        $name = strtolower(Pos::str($request->query('name', '')));
        $phone = preg_replace('/\D/', '', Pos::str($request->query('phone', '')));
        if ($name === '' || $phone === '') return response()->json(['requests' => []]);

        $mine = [];
        foreach (($this->store->read($userId)['requests'] ?? []) as $entry) {
            if (!is_array($entry)) continue;
            $sameName = strtolower(Pos::str($entry['customerName'] ?? '')) === $name;
            $samePhone = preg_replace('/\D/', '', Pos::str($entry['customerPhone'] ?? '')) === $phone;
            if ($sameName && $samePhone) $mine[] = $entry;
        }
        usort($mine, fn ($a, $b) => strcmp($b['createdAt'] ?? '', $a['createdAt'] ?? ''));
        return response()->json(['requests' => $mine]);
    }

    /** File a request. Same stored shape as the shop's own POST /api/requests. */
    public function store_(HttpRequest $request, string $code)
    {
        $userId = $this->shopOr404($code);
        if ($userId === null) return $this->fail('This link is not valid.', 404);

        $body = $request->json()->all();
        $customerName = Pos::str($body['customerName'] ?? '');
        if ($customerName === '') return $this->fail('Your name is required.');
        $customerPhone = Pos::str($body['customerPhone'] ?? '');
        if (preg_replace('/\D/', '', $customerPhone) === '') return $this->fail('Your phone number is required.');

        $rawItems = is_array($body['items'] ?? null) ? $body['items'] : [];
        if (count($rawItems) > self::MAX_ITEMS_PER_REQUEST) {
            return $this->fail('Too many items in one request. Please send at most ' . self::MAX_ITEMS_PER_REQUEST . '.');
        }

        $store = $this->store->read($userId);
        if (!is_array($store['requests'] ?? null)) $store['requests'] = [];

        // Requests from the public link are matched against real inventory: an
        // itemId that does not exist (or is sold) is dropped, and the name,
        // weight and karat are taken from the shop's own record, never from
        // the request body.
        $byId = [];
        foreach (($store['items'] ?? []) as $item) {
            if (is_array($item) && ($item['id'] ?? null)) $byId[(string) $item['id']] = $item;
        }

        $items = [];
        foreach ($rawItems as $raw) {
            if (!is_array($raw)) continue;
            $itemId = Pos::str($raw['itemId'] ?? '');
            if ($itemId === '' || !isset($byId[$itemId]) || !$this->isAvailable($byId[$itemId])) continue;
            $item = $byId[$itemId];
            // A customer can never ask for more than the shop has on the shelf,
            // however the request body was crafted.
            $available = (int) Pos::num($item['quantity'] ?? 0);
            $quantity = max(1, (int) Pos::num($raw['quantity'] ?? 1));
            $items[] = [
                'id' => Pos::newId('ri'),
                'itemId' => $itemId,
                'itemCode' => mb_substr(Pos::str($item['itemNumber'] ?? '') ?: Pos::str($item['sku'] ?? ''), 0, 60),
                'name' => mb_substr(Pos::str($item['name'] ?? ''), 0, 200),
                'category' => Pos::str($item['category'] ?? ''),
                'unit' => self::unitLabel($item),
                'karat' => Pos::num($item['karat'] ?? 0),
                'weightGrams' => max(0, Pos::num($item['weightGrams'] ?? 0)),
                'quantity' => min($available, $quantity),
                'price' => max(0, Pos::num($item['salePrice'] ?? 0)),
                'note' => '',
            ];
        }
        if (!$items) return $this->fail('Pick at least one item that is still in stock.');

        $now = Pos::nowIso();
        $entry = [
            'id' => Pos::newId('req'),
            'requestNumber' => StoreLogic::nextRequestNumber($store),
            'status' => 'open',
            'customerName' => mb_substr($customerName, 0, 120),
            'customerPhone' => mb_substr($customerPhone, 0, 40),
            'items' => $items,
            'note' => mb_substr(Pos::str($body['note'] ?? ''), 0, 500),
            'source' => 'link',
            'fulfilledAt' => null,
            'createdAt' => $now,
            'updatedAt' => $now,
        ];
        array_unshift($store['requests'], $entry);
        StoreLogic::upsertCustomerInStore($store, [
            'name' => $entry['customerName'],
            'phone' => $entry['customerPhone'],
        ]);
        $this->store->write($userId, $store);

        return response()->json($entry, 201);
    }

    /** Signed-in shop owner: "what link do I share with customers?" */
    public function link(HttpRequest $request)
    {
        $userId = $this->userId($request);
        $code = self::codeFor($userId);
        $base = rtrim((string) (config('app.url') ?: $request->getSchemeAndHttpHost()), '/');
        return response()->json([
            'code' => $code,
            'url' => $base . '/order/' . $code,
            'pageUrl' => $base . '/customer.html?shop=' . $code,
        ]);
    }
}
