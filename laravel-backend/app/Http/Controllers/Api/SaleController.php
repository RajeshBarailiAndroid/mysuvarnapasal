<?php

namespace App\Http\Controllers\Api;

use App\Services\MetalRates;
use App\Support\Pos;
use App\Support\StoreLogic;
use Illuminate\Http\Request;

/**
 * Sales are immutable invoices (ported from routes/api.ts).
 * POST /api/sales is the single atomic checkout path; corrections go
 * through POST /api/sales/:id/void.
 */
class SaleController extends ApiController
{
    public function store_(Request $request)
    {
        $store = $this->readStore($request);
        if (!is_array($store['sales'] ?? null)) $store['sales'] = [];
        $body = $request->json()->all();
        $customerName = Pos::str($body['customerName'] ?? '');
        if ($customerName === '') return $this->fail('Customer name is required.');
        $rawLines = is_array($body['lines'] ?? null) ? $body['lines'] : [];
        if (!count($rawLines)) return $this->fail('At least one line is required.');

        $metals = MetalRates::resolve($store);
        $now = Pos::nowIso();

        // 1) Build snapshot lines; validate everything before touching stock.
        $lines = [];
        foreach ($rawLines as $raw) {
            if (!is_array($raw)) $raw = [];
            $qty = max(1, (int) floor(Pos::num($raw['quantity'] ?? 0, 0) ?: 1));
            if ($qty > 100000) return $this->fail('Quantity on a line is too large.');
            if ($err = Pos::amountError($raw, ['unitPrice', 'price', 'weightGrams', 'karat', 'makingCharge', 'jartiRateValue', 'customRatePerTola', 'stoneAmount'])) {
                return $this->fail($err);
            }
            if (!empty($raw['itemId']) && empty($raw['custom']) && empty($raw['fromOrder'])) {
                $item = null;
                foreach ($store['items'] as $i) if (($i['id'] ?? null) === $raw['itemId']) { $item = $i; break; }
                if (!$item) return $this->fail("Item not found: {$raw['itemId']}", 404);
                if (Pos::isItemSoldOut($item) || $item['quantity'] < $qty) {
                    return $this->fail("Not enough stock for {$item['name']}.");
                }
                $unitPrice = Pos::itemValue($item, $metals);
                $lines[] = [
                    'inventory' => true, 'itemId' => $item['id'], 'sku' => $item['sku'], 'name' => $item['name'],
                    'category' => $item['category'] ?? 'gold', 'quantity' => $qty,
                    'unitPrice' => $unitPrice, 'lineTotal' => $unitPrice * $qty,
                    'weightGrams' => Pos::num($item['weightGrams'] ?? 0), 'karat' => Pos::num($item['karat'] ?? 0) ?: 24,
                    'makingCharge' => Pos::num($item['makingCharge'] ?? 0),
                    'jartiRateType' => $item['jartiRateType'] ?? 'flat', 'jartiRateValue' => Pos::num($item['jartiRateValue'] ?? 0),
                    'ratePerTola' => Pos::metalRateForItem($item, $metals),
                    // Guarantee-bill columns (informational; already included in unitPrice)
                    'hsCode' => Pos::str($raw['hsCode'] ?? $item['hsCode'] ?? ''),
                    'stoneAmount' => max(0, (int) round(Pos::num($raw['stoneAmount'] ?? $item['stoneAmount'] ?? 0))),
                ];
            } else {
                $name = Pos::str($raw['name'] ?? $raw['itemName'] ?? '');
                $unitPrice = Pos::numOrNull($raw['unitPrice'] ?? $raw['price'] ?? null);
                if ($name === '') return $this->fail('Custom line items need a name.');
                if ($unitPrice === null || $unitPrice < 0) return $this->fail("A valid price is required for {$name}.");
                $category = Pos::str($raw['category'] ?? 'gold') ?: 'gold';
                $lines[] = [
                    'inventory' => false, 'itemId' => null,
                    'sku' => (string) ($raw['sku'] ?? '') !== '' ? (string) $raw['sku'] : 'CUSTOM',
                    'name' => $name, 'category' => $category, 'quantity' => $qty,
                    'unitPrice' => (int) round($unitPrice), 'lineTotal' => ((int) round($unitPrice)) * $qty,
                    'weightGrams' => Pos::num($raw['weightGrams'] ?? 0), 'karat' => Pos::num($raw['karat'] ?? 0),
                    'makingCharge' => Pos::num($raw['makingCharge'] ?? 0),
                    'jartiRateType' => $raw['jartiRateType'] ?? null, 'jartiRateValue' => Pos::num($raw['jartiRateValue'] ?? 0),
                    'ratePerTola' => Pos::num($raw['customRatePerTola'] ?? 0)
                        ?: ($category === 'silver' ? Pos::num($metals['silverRatePerTola'] ?? 0) : Pos::num($metals['goldRatePerTola'] ?? 0)),
                    'fromOrder' => $raw['fromOrder'] ?? null, 'orderNumber' => $raw['orderNumber'] ?? null,
                    'notes' => Pos::str($raw['notes'] ?? ''),
                    'hsCode' => Pos::str($raw['hsCode'] ?? ''),
                    'stoneAmount' => max(0, (int) round(Pos::num($raw['stoneAmount'] ?? 0))),
                ];
            }
        }

        // 2) Totals (all amounts in NPR; server-side math is authoritative).
        $subtotal = array_sum(array_map(fn ($l) => $l['lineTotal'], $lines));
        if ($err = Pos::amountError($body, ['discount', 'taxValue', 'paidNow', 'paid', 'amountPaid'])) return $this->fail($err);
        $discount = min(max(0, (int) round(Pos::num($body['discount'] ?? 0))), $subtotal);
        $afterDiscount = $subtotal - $discount;
        $taxType = (($body['taxType'] ?? null) === null || ($body['taxType'] ?? null) === 'percent') ? 'percent' : 'flat';
        $taxValue = max(0, Pos::num($body['taxValue'] ?? 0));
        $taxAmount = $taxValue > 0
            ? ($taxType === 'percent' ? (int) round(($afterDiscount * $taxValue) / 100) : (int) round($taxValue))
            : 0;

        // Optional 0.5% Skill Promotion Fee (सिप प्रवर्द्धन शुल्क).
        $skillFeeEnabled = !empty($body['skillFee']);
        $skillFeeAmount = $skillFeeEnabled ? (int) round($afterDiscount * 0.005) : 0;

        // 3) Old-gold trade-in credit.
        $oldGold = null;
        if (is_array($body['oldGold'] ?? null) && Pos::num($body['oldGold']['weightGrams'] ?? 0) > 0) {
            $og = $body['oldGold'];
            $weightGrams = Pos::num($og['weightGrams']);
            $karat = Pos::num($og['karat'] ?? 0) ?: 22;
            $ratePerTola = Pos::num($og['ratePerTola'] ?? 0)
                ?: Pos::num($store['settings']['goldBuyRatePerTola'] ?? 0)
                ?: Pos::num($metals['goldRatePerTola'] ?? 0);
            if ($ratePerTola <= 0) return $this->fail('Old-gold rate per tola is required.');
            $oldGold = [
                'weightGrams' => $weightGrams, 'karat' => $karat, 'ratePerTola' => $ratePerTola,
                'description' => Pos::str($og['description'] ?? ''),
                'credit' => Pos::oldGoldBuyValue($weightGrams, $karat, $ratePerTola),
            ];
        }

        // 4) Gold-scheme redemption credit.
        $scheme = null;
        $schemeIdx = null;
        if (!empty($body['schemeId'])) {
            foreach (($store['schemes'] ?? []) as $i => $s) {
                if (($s['id'] ?? null) === $body['schemeId']) { $scheme = $s; $schemeIdx = $i; break; }
            }
            if (!$scheme) return $this->fail('Scheme not found.', 404);
            if ($scheme['status'] !== 'active' && $scheme['status'] !== 'matured') {
                return $this->fail("Scheme {$scheme['schemeNumber']} is {$scheme['status']} and cannot be redeemed.");
            }
            if (Pos::schemePaidTotal($scheme) <= 0) return $this->fail('Scheme has no deposits to redeem.');
        }
        $schemeCredit = $scheme ? Pos::schemePaidTotal($scheme) : 0;
        $oldGoldCredit = $oldGold ? $oldGold['credit'] : 0;

        $grossTotal = $afterDiscount + $taxAmount + $skillFeeAmount;
        $creditApplied = min($grossTotal, $oldGoldCredit + $schemeCredit);
        $total = $grossTotal - $creditApplied;
        $creditOverflow = max(0, $oldGoldCredit + $schemeCredit - $grossTotal);

        // 5) Payment.
        $pay = is_array($body['payment'] ?? null) ? $body['payment'] : [];
        $method = in_array($pay['method'] ?? null, Pos::PAYMENT_METHODS, true) ? $pay['method'] : 'cash';
        $received = 0; $change = 0; $due = 0;
        if ($method === 'credit') {
            // Partial payment now, rest on credit: total 10,000 with 3,000 paid
            // → received 3,000, due 7,000. Both are saved on the invoice.
            $received = (($pay['received'] ?? null) !== null && ($pay['received'] ?? null) !== '')
                ? min(max(0, (int) round(Pos::num($pay['received']))), $total)
                : 0;
            $due = max(0, $total - $received);
        } elseif ($method === 'cash') {
            $received = (($pay['received'] ?? null) !== null && ($pay['received'] ?? null) !== '')
                ? max(0, Pos::num($pay['received']))
                : $total;
            $change = max(0, $received - $total);
            $due = max(0, $total - $received);
        } else {
            $received = $total;
        }

        // 6) All validation passed — apply stock deductions.
        foreach ($lines as $line) {
            if (empty($line['inventory'])) continue;
            foreach ($store['items'] as $i => $item) {
                if (($item['id'] ?? null) !== $line['itemId']) continue;
                $store['items'][$i]['quantity'] -= $line['quantity'];
                if ($store['items'][$i]['quantity'] <= 0) {
                    $store['items'][$i]['quantity'] = 0;
                    $store['items'][$i]['status'] = 'sold_out';
                }
                $store['items'][$i]['updatedAt'] = $now;
                break;
            }
        }

        $invoiceNumber = StoreLogic::nextInvoiceNumber($store);
        $saleId = Pos::newId('sale');

        // 7) Transaction entries (stock/audit trail), tagged with the invoice number.
        foreach ($lines as $line) {
            $orderSuffix = !empty($line['orderNumber']) ? " · Order {$line['orderNumber']}" : '';
            array_unshift($store['transactions'], [
                'id' => Pos::newId('tx'), 'type' => 'sale', 'itemId' => $line['itemId'], 'itemName' => $line['name'],
                'quantity' => $line['quantity'], 'amount' => $line['lineTotal'],
                'note' => "Sale {$invoiceNumber} — {$customerName}{$orderSuffix}",
                'createdAt' => $now,
            ]);
        }

        // 8) Old-gold exchange entry linked to this sale.
        if ($oldGold) {
            if (!is_array($store['oldGoldExchanges'] ?? null)) $store['oldGoldExchanges'] = [];
            array_unshift($store['oldGoldExchanges'], [
                'id' => Pos::newId('og'), 'customerName' => $customerName,
                'customerPhone' => Pos::str($body['customerPhone'] ?? ''),
                'weightGrams' => $oldGold['weightGrams'], 'karat' => $oldGold['karat'],
                'ratePerTola' => $oldGold['ratePerTola'], 'buyValue' => $oldGold['credit'],
                'description' => $oldGold['description'] !== '' ? $oldGold['description'] : "Trade-in on {$invoiceNumber}",
                'saleId' => $saleId, 'invoiceNumber' => $invoiceNumber,
                'date' => substr($now, 0, 10), 'createdAt' => $now,
            ]);
        }

        // 9) Scheme redemption.
        if ($scheme !== null) {
            $scheme['status'] = 'redeemed';
            $scheme['redeemedAt'] = $now;
            $scheme['redeemedAmount'] = $schemeCredit;
            $scheme['saleId'] = $saleId;
            $scheme['invoiceNumber'] = $invoiceNumber;
            $scheme['updatedAt'] = $now;
            $store['schemes'][$schemeIdx] = $scheme;
        }

        // Guarantee-bill extras — snapshotted verbatim onto the immutable invoice.
        $be = is_array($body['bill'] ?? null) ? $body['bill'] : [];
        $bill = [
            'buyerIdNo' => Pos::str($be['buyerIdNo'] ?? ''),
            'buyerAddress' => Pos::str($be['buyerAddress'] ?? ''),
            'orderDate' => Pos::str($be['orderDate'] ?? ''),
            'deliveryDate' => Pos::str($be['deliveryDate'] ?? ''),
            'kaligadh' => Pos::str($be['kaligadh'] ?? ''),
            'oldWeightGrams' => max(0, Pos::num($be['oldWeightGrams'] ?? 0)),
            'addWeightGrams' => max(0, Pos::num($be['addWeightGrams'] ?? 0)),
            'chequeNo' => Pos::str($be['chequeNo'] ?? ''),
            'qrRef' => Pos::str($be['qrRef'] ?? ''),
        ];

        $sale = [
            'id' => $saleId, 'invoiceNumber' => $invoiceNumber, 'status' => 'completed',
            'customerName' => $customerName,
            'customerPhone' => Pos::str($body['customerPhone'] ?? ''),
            'customerPan' => Pos::str($body['customerPan'] ?? ''),
            'lines' => $lines,
            'subtotal' => $subtotal, 'discount' => $discount, 'afterDiscount' => $afterDiscount,
            'taxType' => $taxType, 'taxValue' => $taxValue, 'taxAmount' => $taxAmount,
            'skillFee' => $skillFeeEnabled, 'skillFeeAmount' => $skillFeeAmount,
            'bill' => $bill,
            'oldGold' => $oldGold, 'oldGoldCredit' => $oldGoldCredit,
            'schemeId' => $scheme ? $scheme['id'] : null,
            'schemeNumber' => $scheme ? ($scheme['schemeNumber'] ?? null) : null,
            'schemeCredit' => $schemeCredit,
            'creditApplied' => $creditApplied, 'creditOverflow' => $creditOverflow, 'total' => $total,
            'payment' => ['method' => $method, 'received' => $received, 'change' => $change, 'due' => $due],
            'rateSnapshot' => [
                'goldRatePerTola' => Pos::num($metals['goldRatePerTola'] ?? 0),
                'silverRatePerTola' => Pos::num($metals['silverRatePerTola'] ?? 0),
                'source' => !empty($metals['live']) ? ('api:' . ($metals['source'] ?? 'live')) : 'manual',
                'fxCurrency' => $metals['fx']['currency'] ?? 'NPR',
                'fxNprPerUnit' => Pos::num($metals['fx']['nprPerUnit'] ?? 0) ?: 1,
                'capturedAt' => $now,
            ],
            'note' => Pos::str($body['note'] ?? ''),
            'payments' => [],
            'voidedAt' => null, 'voidReason' => null,
            'createdAt' => $now,
        ];
        array_unshift($store['sales'], $sale);

        // 10) Credit (udharo): the due amount also becomes a detailed entry in
        // Records → Credit, linked to this invoice. Receipts recorded on the
        // invoice are mirrored onto it automatically.
        if ($due > 0) {
            self::addLinkedCreditRecord($store, $sale, $now);
        }

        StoreLogic::upsertCustomerInStore($store, ['name' => $customerName, 'phone' => $sale['customerPhone']]);
        $this->writeStore($request, $store);
        return response()->json(Pos::withDueFields($sale), 201);
    }

    /**
     * Add a Records → Credit entry for a sale carrying an outstanding due.
     * The record carries the COMPLETE checkout information — person, invoice,
     * total, paid amount, credit amount, date, and every line's details
     * (item, quantity, weight, karat, price) — copied verbatim from the sale
     * so Checkout and Credit records stay connected and consistent.
     */
    private static function addLinkedCreditRecord(array &$store, array $sale, string $now): void
    {
        if (!is_array($store['options'] ?? null)) $store['options'] = [];
        $isOpeningDue = ($sale['type'] ?? '') === 'opening_due';
        $lines = is_array($sale['lines'] ?? null) ? $sale['lines'] : [];

        // "Ring ×2 · 25.5g 22K, Chain · 10g 24K" — item + qty + gold details.
        $detailParts = [];
        $goldWeight = 0.0;
        foreach ($lines as $l) {
            $p = (string) ($l['name'] ?? 'Item');
            if (Pos::num($l['quantity'] ?? 1) > 1) $p .= ' ×' . $l['quantity'];
            if (Pos::num($l['weightGrams'] ?? 0) > 0) {
                $p .= ' · ' . $l['weightGrams'] . 'g';
                if (Pos::num($l['karat'] ?? 0) > 0) $p .= ' ' . $l['karat'] . 'K';
                $goldWeight += Pos::num($l['weightGrams']) * max(1, Pos::num($l['quantity'] ?? 1));
            }
            $detailParts[] = $p;
        }
        $phone = Pos::str($sale['customerPhone'] ?? '');
        $creditFor = $isOpeningDue
            ? 'Cash'
            : (implode(', ', array_map(fn ($l) => (string) ($l['name'] ?? 'Item'), $lines)) ?: 'Cash');

        array_unshift($store['options'], [
            'id' => Pos::newId('opt'), 'type' => 'credit',
            'metal' => $goldWeight > 0 ? 'gold' : 'cash',
            'name' => $sale['customerName'] ?? 'Walk-in',
            'item' => mb_substr(implode(', ', $detailParts), 0, 400),
            'creditFor' => mb_substr($creditFor, 0, 200),
            'weightGrams' => round($goldWeight, 3), 'karat' => 0, 'rate' => 0,
            'cost' => Pos::num($sale['payment']['due'] ?? 0),
            'date' => substr((string) ($sale['createdAt'] ?? $now), 0, 10),
            'committedDate' => '',
            'notes' => ($isOpeningDue ? 'Old due ' : 'Credit sale ') . ($sale['invoiceNumber'] ?? '')
                . ($phone !== '' ? " · {$phone}" : ''),
            'payments' => [], 'status' => 'open',
            'saleId' => $sale['id'], 'invoiceNumber' => $sale['invoiceNumber'] ?? '',
            'customerPhone' => $phone,
            'saleTotal' => Pos::num($sale['total'] ?? 0),
            'salePaid' => Pos::num($sale['payment']['received'] ?? 0),
            'saleLines' => array_map(fn ($l) => [
                'name' => (string) ($l['name'] ?? ''),
                'quantity' => Pos::num($l['quantity'] ?? 1),
                'weightGrams' => Pos::num($l['weightGrams'] ?? 0),
                'karat' => Pos::num($l['karat'] ?? 0),
                'unitPrice' => Pos::num($l['unitPrice'] ?? 0),
                'lineTotal' => Pos::num($l['lineTotal'] ?? 0),
                'category' => (string) ($l['category'] ?? ''),
            ], $lines),
            'createdAt' => $now, 'updatedAt' => $now,
        ]);
    }

    /** Record an opening balance / manual due (old udharo from the paper khata). */
    public function manualDue(Request $request)
    {
        $store = $this->readStore($request);
        if (!is_array($store['sales'] ?? null)) $store['sales'] = [];
        $body = $request->json()->all();
        $customerName = Pos::str($body['customerName'] ?? '');
        $amount = (int) round(Pos::num($body['amount'] ?? 0));
        if ($customerName === '') return $this->fail('Customer name is required.');
        if ($amount <= 0) return $this->fail('Due amount must be greater than 0.');
        $now = Pos::nowIso();
        $dateStr = substr(Pos::str($body['date'] ?? ''), 0, 10);
        $createdAt = (preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateStr) && $dateStr <= substr($now, 0, 10))
            ? "{$dateStr}T00:00:00.000Z"
            : $now;
        $note = Pos::str($body['note'] ?? '');
        $n = (int) Pos::num($store['settings']['dueCounter'] ?? 0) + 1;
        $store['settings']['dueCounter'] = $n;
        $sale = [
            'id' => Pos::newId('sale'),
            'invoiceNumber' => 'DUE-' . str_pad((string) $n, 4, '0', STR_PAD_LEFT),
            'type' => 'opening_due', 'status' => 'completed',
            'customerName' => $customerName, 'customerPhone' => Pos::str($body['customerPhone'] ?? ''), 'customerPan' => '',
            'lines' => [[
                'inventory' => false, 'itemId' => null, 'sku' => 'DUE',
                'name' => $note !== '' ? $note : 'Opening balance (old khata)',
                'category' => 'other', 'quantity' => 1, 'unitPrice' => $amount, 'lineTotal' => $amount,
                'weightGrams' => 0, 'karat' => 0, 'makingCharge' => 0,
                'jartiRateType' => null, 'jartiRateValue' => 0, 'ratePerTola' => 0,
            ]],
            'subtotal' => $amount, 'discount' => 0, 'afterDiscount' => $amount,
            'taxType' => 'percent', 'taxValue' => 0, 'taxAmount' => 0,
            'oldGold' => null, 'oldGoldCredit' => 0, 'schemeId' => null, 'schemeNumber' => null, 'schemeCredit' => 0,
            'creditApplied' => 0, 'creditOverflow' => 0, 'total' => $amount,
            'payment' => ['method' => 'credit', 'received' => 0, 'change' => 0, 'due' => $amount],
            'rateSnapshot' => null, 'note' => $note,
            'payments' => [],
            'voidedAt' => null, 'voidReason' => null,
            'createdAt' => $createdAt,
        ];
        array_unshift($store['sales'], $sale);
        // Old khata dues are credit too — add the matching Records → Credit entry.
        self::addLinkedCreditRecord($store, $sale, $now);
        StoreLogic::upsertCustomerInStore($store, ['name' => $customerName, 'phone' => $sale['customerPhone']]);
        $this->writeStore($request, $store);
        return response()->json(Pos::withDueFields($sale), 201);
    }

    public function index(Request $request)
    {
        $store = $this->readStore($request);
        $start = $request->query('start') ? substr((string) $request->query('start'), 0, 10) : null;
        $end = $request->query('end') ? substr((string) $request->query('end'), 0, 10) : null;
        $sales = $store['sales'] ?? [];
        if ($start || $end) $sales = array_values(array_filter($sales, fn ($s) => Pos::inDateRange($s['createdAt'] ?? '', $start, $end)));
        if ($request->query('due') === 'open') {
            $sales = array_values(array_filter($sales, fn ($s) => ($s['status'] ?? '') !== 'voided' && Pos::saleDueRemaining($s) > 0));
        }
        usort($sales, fn ($a, $b) => strcmp($b['createdAt'] ?? '', $a['createdAt'] ?? ''));
        $outstandingTotal = 0;
        foreach (($store['sales'] ?? []) as $s) {
            if (($s['status'] ?? '') !== 'voided') $outstandingTotal += Pos::saleDueRemaining($s);
        }
        return response()->json([
            'sales' => array_map([Pos::class, 'withDueFields'], $sales),
            'outstandingTotal' => $outstandingTotal,
        ]);
    }

    public function show(Request $request, string $id)
    {
        $store = $this->readStore($request);
        foreach (($store['sales'] ?? []) as $sale) {
            if (($sale['id'] ?? null) === $id) return response()->json(Pos::withDueFields($sale));
        }
        return $this->fail('Sale not found.', 404);
    }

    /** Record a payment received against a sale's outstanding due. */
    public function addPayment(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $idx = null;
        foreach (($store['sales'] ?? []) as $i => $s) if (($s['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Sale not found.', 404);
        $sale = $store['sales'][$idx];
        if (($sale['status'] ?? '') === 'voided') return $this->fail('This sale is voided; no payments can be recorded.');
        $dueRemaining = Pos::saleDueRemaining($sale);
        if ($dueRemaining <= 0) return $this->fail('This sale has no outstanding due.');
        $body = $request->json()->all();
        $amount = (int) round(Pos::num($body['amount'] ?? 0));
        if ($amount <= 0) return $this->fail('Payment amount must be greater than 0.');
        if ($amount > $dueRemaining) return $this->fail("Amount exceeds the outstanding due ({$dueRemaining}).");
        $method = (in_array($body['method'] ?? null, Pos::PAYMENT_METHODS, true) && ($body['method'] ?? null) !== 'credit')
            ? $body['method'] : 'cash';
        $now = Pos::nowIso();
        $payment = [
            'id' => Pos::newId('pay'), 'amount' => $amount, 'method' => $method,
            'date' => Pos::str($body['date'] ?? '') ?: substr($now, 0, 10),
            'note' => Pos::str($body['note'] ?? ''), 'createdAt' => $now,
        ];
        if (!is_array($sale['payments'] ?? null)) $sale['payments'] = [];
        $sale['payments'][] = $payment;
        $noteSuffix = $payment['note'] !== '' ? " · {$payment['note']}" : '';
        array_unshift($store['transactions'], [
            'id' => Pos::newId('tx'), 'type' => 'credit_payment', 'itemId' => null,
            'itemName' => "Payment {$sale['invoiceNumber']}", 'quantity' => 0, 'amount' => $amount,
            'note' => "Payment received {$sale['invoiceNumber']} — {$sale['customerName']} · {$method}{$noteSuffix}",
            'createdAt' => $now,
        ]);
        $store['sales'][$idx] = $sale;

        // Mirror the receipt onto the linked Records → Credit entry, if any.
        if (is_array($store['options'] ?? null)) {
            foreach ($store['options'] as $oi => $opt) {
                if (($opt['saleId'] ?? null) !== $sale['id']) continue;
                if (!is_array($opt['payments'] ?? null)) $opt['payments'] = [];
                $opt['payments'][] = [
                    'id' => Pos::newId('pay'), 'amount' => $amount,
                    'date' => $payment['date'],
                    'note' => trim(ucfirst($method) . ($payment['note'] !== '' ? ' · ' . $payment['note'] : '') . ' (via invoice)'),
                    'createdAt' => $now,
                ];
                $paidTotal = 0;
                foreach ($opt['payments'] as $p) $paidTotal += Pos::num($p['amount'] ?? 0);
                if ($paidTotal >= Pos::num($opt['cost'] ?? 0)) $opt['status'] = 'closed';
                $opt['updatedAt'] = $now;
                $store['options'][$oi] = $opt;
                break;
            }
        }

        $this->writeStore($request, $store);
        return response()->json(['payment' => $payment, 'sale' => Pos::withDueFields($sale)], 201);
    }

    /** Void a sale: restore stock, tag transactions [VOIDED], revert linked trade-in/scheme. */
    public function void(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $idx = null;
        foreach (($store['sales'] ?? []) as $i => $s) if (($s['id'] ?? null) === $id) { $idx = $i; break; }
        if ($idx === null) return $this->fail('Sale not found.', 404);
        $sale = $store['sales'][$idx];
        if (($sale['status'] ?? '') === 'voided') return $this->fail('Sale is already voided.');
        if (count($sale['payments'] ?? [])) {
            return $this->fail('Payments have been received against this sale. Settle or refund those first — this invoice can no longer be voided automatically.');
        }
        $reason = Pos::str($request->json()->all()['reason'] ?? '');
        if ($reason === '') return $this->fail('A reason is required to void a sale.');
        $now = Pos::nowIso();

        foreach (($sale['lines'] ?? []) as $line) {
            if (empty($line['inventory']) || empty($line['itemId'])) continue;
            foreach ($store['items'] as $i => $item) {
                if (($item['id'] ?? null) !== $line['itemId']) continue;
                $store['items'][$i]['quantity'] += $line['quantity'];
                if ($store['items'][$i]['quantity'] > 0) $store['items'][$i]['status'] = 'in_stock';
                $store['items'][$i]['updatedAt'] = $now;
                break;
            }
        }

        foreach ($store['transactions'] as $i => $tx) {
            $note = (string) ($tx['note'] ?? '');
            if (($tx['type'] ?? '') === 'sale' && str_contains($note, $sale['invoiceNumber']) && !str_contains($note, '[VOIDED]')) {
                $store['transactions'][$i]['note'] = "{$note} [VOIDED]";
            }
        }
        array_unshift($store['transactions'], [
            'id' => Pos::newId('tx'), 'type' => 'void', 'itemId' => null,
            'itemName' => "Void {$sale['invoiceNumber']}", 'quantity' => 0,
            'amount' => -Pos::num($sale['total'] ?? 0),
            'note' => "Void {$sale['invoiceNumber']} — {$reason}", 'createdAt' => $now,
        ]);

        if (!empty($sale['oldGold'])) {
            foreach (($store['oldGoldExchanges'] ?? []) as $i => $e) {
                if (($e['saleId'] ?? null) === $sale['id']) {
                    $store['oldGoldExchanges'][$i]['voided'] = true;
                    $store['oldGoldExchanges'][$i]['voidedAt'] = $now;
                    break;
                }
            }
        }

        if (!empty($sale['schemeId'])) {
            foreach (($store['schemes'] ?? []) as $i => $scheme) {
                if (($scheme['id'] ?? null) === $sale['schemeId']
                    && ($scheme['status'] ?? '') === 'redeemed'
                    && ($scheme['saleId'] ?? null) === $sale['id']) {
                    $scheme['status'] = 'active';
                    unset($scheme['redeemedAt'], $scheme['redeemedAmount'], $scheme['saleId'], $scheme['invoiceNumber']);
                    $scheme['updatedAt'] = $now;
                    $store['schemes'][$i] = $scheme;
                    break;
                }
            }
        }

        // Remove the linked Records → Credit entry (a voidable sale has no
        // receipts, so the linked record has no mirrored payments either).
        if (is_array($store['options'] ?? null)) {
            $store['options'] = array_values(array_filter(
                $store['options'],
                fn ($o) => ($o['saleId'] ?? null) !== $sale['id']
            ));
        }

        $sale['status'] = 'voided';
        $sale['voidedAt'] = $now;
        $sale['voidReason'] = $reason;
        $store['sales'][$idx] = $sale;
        $this->writeStore($request, $store);
        return response()->json($sale);
    }
}
