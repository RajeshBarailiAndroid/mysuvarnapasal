package com.subarnapasal.store

import com.subarnapasal.common.ApiException
import com.subarnapasal.common.Doc
import com.subarnapasal.common.Pos
import com.subarnapasal.common.asDoc
import com.subarnapasal.common.asDocList
import com.subarnapasal.common.asDocOrNull
import com.subarnapasal.common.listAt
import com.subarnapasal.common.newDoc
import com.subarnapasal.common.userId
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import kotlin.math.max
import kotlin.math.min

/**
 * Sales are immutable invoices. POST /api/sales is the single atomic
 * checkout path; corrections go through POST /api/sales/{id}/void.
 * Ported line-for-line from the Laravel SaleController.
 */
@RestController
class SaleController(private val repo: StoreRepository) {

    @PostMapping("/api/sales")
    fun create(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val sale = repo.update(request.userId()) { store ->
            val customerName = Pos.str(body["customerName"])
            if (customerName.isEmpty()) throw ApiException("Customer name is required.")
            val rawLines = (body["lines"] as? List<*>) ?: emptyList<Any?>()
            if (rawLines.isEmpty()) throw ApiException("At least one line is required.")

            val metals = Pos.resolveMetalRates(store)
            val now = Pos.nowIso()
            val items = store["items"].asDocList()

            // 1) Build snapshot lines; validate everything before touching stock.
            val lines = mutableListOf<Doc>()
            for (rawAny in rawLines) {
                val raw = rawAny.asDocOrNull() ?: linkedMapOf()
                val qty = max(1L, Math.floor(Pos.num(raw["quantity"]).takeIf { it != 0.0 } ?: 1.0).toLong())
                val isInventory = Pos.str(raw["itemId"]).isNotEmpty()
                    && (raw["custom"] == null || raw["custom"] == false)
                    && (raw["fromOrder"] == null || raw["fromOrder"] == false)
                if (isInventory) {
                    val item = items.firstOrNull { it["id"] == raw["itemId"] }
                        ?: throw ApiException("Item not found: ${raw["itemId"]}", 404)
                    if (Pos.isItemSoldOut(item) || Pos.num(item["quantity"]) < qty) {
                        throw ApiException("Not enough stock for ${item["name"]}.")
                    }
                    val unitPrice = Pos.itemValue(item, metals)
                    lines.add(newDoc(
                        "inventory" to true, "itemId" to item["id"], "sku" to item["sku"], "name" to item["name"],
                        "category" to (item["category"] ?: "gold"), "quantity" to qty,
                        "unitPrice" to unitPrice, "lineTotal" to unitPrice * qty,
                        "weightGrams" to Pos.num(item["weightGrams"]),
                        "karat" to (Pos.num(item["karat"]).takeIf { it != 0.0 } ?: 24.0),
                        "makingCharge" to Pos.num(item["makingCharge"]),
                        "jartiRateType" to (item["jartiRateType"] ?: "flat"),
                        "jartiRateValue" to Pos.num(item["jartiRateValue"]),
                        "ratePerTola" to Pos.metalRateForItem(item, metals),
                        "hsCode" to Pos.str(raw["hsCode"] ?: item["hsCode"] ?: ""),
                        "stoneAmount" to max(0L, Math.round(Pos.num(raw["stoneAmount"] ?: item["stoneAmount"] ?: 0))),
                    ))
                } else {
                    val name = Pos.str(raw["name"] ?: raw["itemName"])
                    val unitPrice = Pos.numOrNull(raw["unitPrice"] ?: raw["price"])
                    if (name.isEmpty()) throw ApiException("Custom line items need a name.")
                    if (unitPrice == null || unitPrice < 0) throw ApiException("A valid price is required for $name.")
                    val category = Pos.str(raw["category"] ?: "gold").ifEmpty { "gold" }
                    val rounded = Math.round(unitPrice)
                    lines.add(newDoc(
                        "inventory" to false, "itemId" to null,
                        "sku" to (raw["sku"]?.toString()?.takeIf { it.isNotEmpty() } ?: "CUSTOM"),
                        "name" to name, "category" to category, "quantity" to qty,
                        "unitPrice" to rounded, "lineTotal" to rounded * qty,
                        "weightGrams" to Pos.num(raw["weightGrams"]), "karat" to Pos.num(raw["karat"]),
                        "makingCharge" to Pos.num(raw["makingCharge"]),
                        "jartiRateType" to raw["jartiRateType"], "jartiRateValue" to Pos.num(raw["jartiRateValue"]),
                        "ratePerTola" to (Pos.num(raw["customRatePerTola"]).takeIf { it != 0.0 }
                            ?: if (category == "silver") Pos.num(metals["silverRatePerTola"]) else Pos.num(metals["goldRatePerTola"])),
                        "fromOrder" to raw["fromOrder"], "orderNumber" to raw["orderNumber"],
                        "notes" to Pos.str(raw["notes"]),
                        "hsCode" to Pos.str(raw["hsCode"]),
                        "stoneAmount" to max(0L, Math.round(Pos.num(raw["stoneAmount"]))),
                    ))
                }
            }

            // 2) Totals (all NPR; server math is authoritative).
            val subtotal = lines.sumOf { Pos.num(it["lineTotal"]) }
            val discount = min(max(0.0, Math.round(Pos.num(body["discount"])).toDouble()), subtotal)
            val afterDiscount = subtotal - discount
            val taxType = if (body["taxType"] == null || body["taxType"] == "percent") "percent" else "flat"
            val taxValue = max(0.0, Pos.num(body["taxValue"]))
            val taxAmount = if (taxValue > 0) {
                if (taxType == "percent") Math.round((afterDiscount * taxValue) / 100).toDouble() else Math.round(taxValue).toDouble()
            } else 0.0

            // Optional 0.5% Skill Promotion Fee.
            val skillFeeEnabled = body["skillFee"] == true
            val skillFeeAmount = if (skillFeeEnabled) Math.round(afterDiscount * 0.005).toDouble() else 0.0

            // 3) Old-gold trade-in credit.
            var oldGold: Doc? = null
            val ogBody = body["oldGold"].asDocOrNull()
            if (ogBody != null && Pos.num(ogBody["weightGrams"]) > 0) {
                val weightGrams = Pos.num(ogBody["weightGrams"])
                val karat = Pos.num(ogBody["karat"]).takeIf { it != 0.0 } ?: 22.0
                val ratePerTola = Pos.num(ogBody["ratePerTola"]).takeIf { it != 0.0 }
                    ?: Pos.num(store["settings"].asDoc()["goldBuyRatePerTola"]).takeIf { it != 0.0 }
                    ?: Pos.num(metals["goldRatePerTola"])
                if (ratePerTola <= 0) throw ApiException("Old-gold rate per tola is required.")
                oldGold = newDoc(
                    "weightGrams" to weightGrams, "karat" to karat, "ratePerTola" to ratePerTola,
                    "description" to Pos.str(ogBody["description"]),
                    "credit" to Pos.oldGoldBuyValue(weightGrams, karat, ratePerTola),
                )
            }

            // 4) Gold-scheme redemption credit.
            var scheme: Doc? = null
            if (Pos.str(body["schemeId"]).isNotEmpty()) {
                scheme = store["schemes"].asDocList().firstOrNull { it["id"] == body["schemeId"] }
                    ?: throw ApiException("Scheme not found.", 404)
                val st = Pos.str(scheme["status"])
                if (st != "active" && st != "matured") {
                    throw ApiException("Scheme ${scheme["schemeNumber"]} is $st and cannot be redeemed.")
                }
                if (Pos.schemePaidTotal(scheme) <= 0) throw ApiException("Scheme has no deposits to redeem.")
            }
            val schemeCredit = scheme?.let { Pos.schemePaidTotal(it) } ?: 0.0
            val oldGoldCredit = oldGold?.let { Pos.num(it["credit"]) } ?: 0.0

            val grossTotal = afterDiscount + taxAmount + skillFeeAmount
            val creditApplied = min(grossTotal, oldGoldCredit + schemeCredit)
            val total = grossTotal - creditApplied
            val creditOverflow = max(0.0, oldGoldCredit + schemeCredit - grossTotal)

            // 5) Payment.
            val pay = body["payment"].asDocOrNull() ?: linkedMapOf()
            val method = if (pay["method"] in Pos.PAYMENT_METHODS) pay["method"].toString() else "cash"
            var received = 0.0; var change = 0.0; var due = 0.0
            when (method) {
                "credit" -> {
                    received = if (pay["received"] != null && pay["received"] != "")
                        min(max(0.0, Math.round(Pos.num(pay["received"])).toDouble()), total) else 0.0
                    due = max(0.0, total - received)
                }
                "cash" -> {
                    received = if (pay["received"] != null && pay["received"] != "")
                        max(0.0, Pos.num(pay["received"])) else total
                    change = max(0.0, received - total)
                    due = max(0.0, total - received)
                }
                else -> received = total
            }

            // 6) All validation passed — apply stock deductions.
            lines.filter { it["inventory"] == true }.forEach { line ->
                val item = items.firstOrNull { it["id"] == line["itemId"] } ?: return@forEach
                item["quantity"] = Pos.num(item["quantity"]) - Pos.num(line["quantity"])
                if (Pos.num(item["quantity"]) <= 0) {
                    item["quantity"] = 0.0
                    item["status"] = "sold_out"
                }
                item["updatedAt"] = now
            }

            val invoiceNumber = StoreLogic.nextInvoiceNumber(store)
            val saleId = Pos.newId("sale")

            // 7) Transaction audit trail.
            lines.forEach { line ->
                val orderSuffix = if (Pos.str(line["orderNumber"]).isNotEmpty()) " · Order ${line["orderNumber"]}" else ""
                store.listAt("transactions").add(0, newDoc(
                    "id" to Pos.newId("tx"), "type" to "sale", "itemId" to line["itemId"], "itemName" to line["name"],
                    "quantity" to line["quantity"], "amount" to line["lineTotal"],
                    "note" to "Sale $invoiceNumber — $customerName$orderSuffix",
                    "createdAt" to now,
                ))
            }

            // 8) Old-gold exchange entry linked to this sale.
            if (oldGold != null) {
                store.listAt("oldGoldExchanges").add(0, newDoc(
                    "id" to Pos.newId("og"), "customerName" to customerName,
                    "customerPhone" to Pos.str(body["customerPhone"]),
                    "weightGrams" to oldGold["weightGrams"], "karat" to oldGold["karat"],
                    "ratePerTola" to oldGold["ratePerTola"], "buyValue" to oldGold["credit"],
                    "description" to Pos.str(oldGold["description"]).ifEmpty { "Trade-in on $invoiceNumber" },
                    "saleId" to saleId, "invoiceNumber" to invoiceNumber,
                    "date" to now.take(10), "createdAt" to now,
                ))
            }

            // 9) Scheme redemption.
            if (scheme != null) {
                scheme["status"] = "redeemed"
                scheme["redeemedAt"] = now
                scheme["redeemedAmount"] = schemeCredit
                scheme["saleId"] = saleId
                scheme["invoiceNumber"] = invoiceNumber
                scheme["updatedAt"] = now
            }

            // Guarantee-bill extras.
            val be = body["bill"].asDocOrNull() ?: linkedMapOf()
            val bill = newDoc(
                "buyerIdNo" to Pos.str(be["buyerIdNo"]), "buyerAddress" to Pos.str(be["buyerAddress"]),
                "orderDate" to Pos.str(be["orderDate"]), "deliveryDate" to Pos.str(be["deliveryDate"]),
                "kaligadh" to Pos.str(be["kaligadh"]),
                "oldWeightGrams" to max(0.0, Pos.num(be["oldWeightGrams"])),
                "addWeightGrams" to max(0.0, Pos.num(be["addWeightGrams"])),
                "chequeNo" to Pos.str(be["chequeNo"]), "qrRef" to Pos.str(be["qrRef"]),
            )

            val sale = newDoc(
                "id" to saleId, "invoiceNumber" to invoiceNumber, "status" to "completed",
                "customerName" to customerName,
                "customerPhone" to Pos.str(body["customerPhone"]),
                "customerPan" to Pos.str(body["customerPan"]),
                "lines" to lines,
                "subtotal" to subtotal, "discount" to discount, "afterDiscount" to afterDiscount,
                "taxType" to taxType, "taxValue" to taxValue, "taxAmount" to taxAmount,
                "skillFee" to skillFeeEnabled, "skillFeeAmount" to skillFeeAmount,
                "bill" to bill,
                "oldGold" to oldGold, "oldGoldCredit" to oldGoldCredit,
                "schemeId" to scheme?.get("id"), "schemeNumber" to scheme?.get("schemeNumber"),
                "schemeCredit" to schemeCredit,
                "creditApplied" to creditApplied, "creditOverflow" to creditOverflow, "total" to total,
                "payment" to newDoc("method" to method, "received" to received, "change" to change, "due" to due),
                "rateSnapshot" to newDoc(
                    "goldRatePerTola" to Pos.num(metals["goldRatePerTola"]),
                    "silverRatePerTola" to Pos.num(metals["silverRatePerTola"]),
                    "source" to if (metals["live"] == true) "api:${metals["source"] ?: "live"}" else "manual",
                    "fxCurrency" to (metals["fx"].asDocOrNull()?.get("currency") ?: "NPR"),
                    "fxNprPerUnit" to (Pos.num(metals["fx"].asDocOrNull()?.get("nprPerUnit")).takeIf { it != 0.0 } ?: 1.0),
                    "capturedAt" to now,
                ),
                "note" to Pos.str(body["note"]),
                "payments" to mutableListOf<Any?>(),
                "voidedAt" to null, "voidReason" to null,
                "createdAt" to now,
            )
            store.listAt("sales").add(0, sale)

            // 10) Credit (udharo) record linked to this invoice.
            if (due > 0) addLinkedCreditRecord(store, sale, now)

            StoreLogic.upsertCustomerInStore(store, newDoc("name" to customerName, "phone" to sale["customerPhone"]))
            Pos.withDueFields(sale)
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(sale)
    }

    /** Add a Records → Credit entry carrying the COMPLETE checkout info. */
    private fun addLinkedCreditRecord(store: Doc, sale: Doc, now: String) {
        val isOpeningDue = Pos.str(sale["type"]) == "opening_due"
        val lines = sale["lines"].asDocList()
        val detailParts = mutableListOf<String>()
        var goldWeight = 0.0
        lines.forEach { l ->
            var p = l["name"]?.toString() ?: "Item"
            if (Pos.num(l["quantity"] ?: 1) > 1) p += " ×${l["quantity"]}"
            if (Pos.num(l["weightGrams"]) > 0) {
                p += " · ${l["weightGrams"]}g"
                if (Pos.num(l["karat"]) > 0) p += " ${l["karat"]}K"
                goldWeight += Pos.num(l["weightGrams"]) * max(1.0, Pos.num(l["quantity"] ?: 1))
            }
            detailParts.add(p)
        }
        val phone = Pos.str(sale["customerPhone"])
        val creditFor = if (isOpeningDue) "Cash"
        else lines.joinToString(", ") { it["name"]?.toString() ?: "Item" }.ifEmpty { "Cash" }

        store.listAt("options").add(0, newDoc(
            "id" to Pos.newId("opt"), "type" to "credit",
            "metal" to if (goldWeight > 0) "gold" else "cash",
            "name" to (sale["customerName"] ?: "Walk-in"),
            "item" to detailParts.joinToString(", ").take(400),
            "creditFor" to creditFor.take(200),
            "weightGrams" to Math.round(goldWeight * 1000.0) / 1000.0, "karat" to 0, "rate" to 0,
            "cost" to Pos.num(sale["payment"].asDocOrNull()?.get("due")),
            "date" to (sale["createdAt"]?.toString() ?: now).take(10),
            "committedDate" to "",
            "notes" to (if (isOpeningDue) "Old due " else "Credit sale ") + Pos.str(sale["invoiceNumber"]) +
                (if (phone.isNotEmpty()) " · $phone" else ""),
            "payments" to mutableListOf<Any?>(), "status" to "open",
            "saleId" to sale["id"], "invoiceNumber" to (sale["invoiceNumber"] ?: ""),
            "customerPhone" to phone,
            "saleTotal" to Pos.num(sale["total"]),
            "salePaid" to Pos.num(sale["payment"].asDocOrNull()?.get("received")),
            "saleLines" to lines.map { l ->
                newDoc(
                    "name" to (l["name"]?.toString() ?: ""),
                    "quantity" to Pos.num(l["quantity"] ?: 1),
                    "weightGrams" to Pos.num(l["weightGrams"]),
                    "karat" to Pos.num(l["karat"]),
                    "unitPrice" to Pos.num(l["unitPrice"]),
                    "lineTotal" to Pos.num(l["lineTotal"]),
                    "category" to (l["category"]?.toString() ?: ""),
                )
            },
            "createdAt" to now, "updatedAt" to now,
        ))
    }

    /** Record an opening balance / manual due (old udharo from the paper khata). */
    @PostMapping("/api/sales/manual-due")
    fun manualDue(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val sale = repo.update(request.userId()) { store ->
            val customerName = Pos.str(body["customerName"])
            val amount = Math.round(Pos.num(body["amount"])).toDouble()
            if (customerName.isEmpty()) throw ApiException("Customer name is required.")
            if (amount <= 0) throw ApiException("Due amount must be greater than 0.")
            val now = Pos.nowIso()
            val dateStr = Pos.str(body["date"]).take(10)
            val createdAt = if (Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(dateStr) && dateStr <= now.take(10))
                "${dateStr}T00:00:00.000Z" else now
            val note = Pos.str(body["note"])
            val settings = store["settings"].asDoc()
            val n = Pos.num(settings["dueCounter"]).toLong() + 1
            settings["dueCounter"] = n
            val sale = newDoc(
                "id" to Pos.newId("sale"),
                "invoiceNumber" to "DUE-" + n.toString().padStart(4, '0'),
                "type" to "opening_due", "status" to "completed",
                "customerName" to customerName, "customerPhone" to Pos.str(body["customerPhone"]), "customerPan" to "",
                "lines" to mutableListOf<Any?>(newDoc(
                    "inventory" to false, "itemId" to null, "sku" to "DUE",
                    "name" to note.ifEmpty { "Opening balance (old khata)" },
                    "category" to "other", "quantity" to 1, "unitPrice" to amount, "lineTotal" to amount,
                    "weightGrams" to 0, "karat" to 0, "makingCharge" to 0,
                    "jartiRateType" to null, "jartiRateValue" to 0, "ratePerTola" to 0,
                )),
                "subtotal" to amount, "discount" to 0, "afterDiscount" to amount,
                "taxType" to "percent", "taxValue" to 0, "taxAmount" to 0,
                "oldGold" to null, "oldGoldCredit" to 0, "schemeId" to null, "schemeNumber" to null, "schemeCredit" to 0,
                "creditApplied" to 0, "creditOverflow" to 0, "total" to amount,
                "payment" to newDoc("method" to "credit", "received" to 0, "change" to 0, "due" to amount),
                "rateSnapshot" to null, "note" to note,
                "payments" to mutableListOf<Any?>(),
                "voidedAt" to null, "voidReason" to null,
                "createdAt" to createdAt,
            )
            store.listAt("sales").add(0, sale)
            addLinkedCreditRecord(store, sale, now)
            StoreLogic.upsertCustomerInStore(store, newDoc("name" to customerName, "phone" to sale["customerPhone"]))
            Pos.withDueFields(sale)
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(sale)
    }

    @GetMapping("/api/sales")
    fun index(
        request: HttpServletRequest,
        @RequestParam(required = false) start: String?,
        @RequestParam(required = false) end: String?,
        @RequestParam(required = false) due: String?,
    ): Any {
        val store = repo.read(request.userId())
        val s = start?.take(10)
        val e = end?.take(10)
        var sales = store["sales"].asDocList().toList()
        if (s != null || e != null) sales = sales.filter { Pos.inDateRange(it["createdAt"], s, e) }
        if (due == "open") {
            sales = sales.filter { Pos.str(it["status"]) != "voided" && Pos.saleDueRemaining(it) > 0 }
        }
        sales = sales.sortedByDescending { it["createdAt"]?.toString() ?: "" }
        val outstandingTotal = store["sales"].asDocList()
            .filter { Pos.str(it["status"]) != "voided" }
            .sumOf { Pos.saleDueRemaining(it) }
        return newDoc(
            "sales" to sales.map { Pos.withDueFields(it) },
            "outstandingTotal" to outstandingTotal,
        )
    }

    @GetMapping("/api/sales/{id}")
    fun show(request: HttpServletRequest, @PathVariable id: String): Any {
        val store = repo.read(request.userId())
        val sale = store["sales"].asDocList().firstOrNull { it["id"] == id }
            ?: throw ApiException("Sale not found.", 404)
        return Pos.withDueFields(sale)
    }

    /** Record a payment received against a sale's outstanding due. */
    @PostMapping("/api/sales/{id}/payments")
    fun addPayment(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): ResponseEntity<Any> {
        val result = repo.update(request.userId()) { store ->
            val sale = store["sales"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Sale not found.", 404)
            if (Pos.str(sale["status"]) == "voided") throw ApiException("This sale is voided; no payments can be recorded.")
            val dueRemaining = Pos.saleDueRemaining(sale)
            if (dueRemaining <= 0) throw ApiException("This sale has no outstanding due.")
            val amount = Math.round(Pos.num(body["amount"])).toDouble()
            if (amount <= 0) throw ApiException("Payment amount must be greater than 0.")
            if (amount > dueRemaining) throw ApiException("Amount exceeds the outstanding due (${dueRemaining.toLong()}).")
            val method = if (body["method"] in Pos.PAYMENT_METHODS && body["method"] != "credit")
                body["method"].toString() else "cash"
            val now = Pos.nowIso()
            val payment = newDoc(
                "id" to Pos.newId("pay"), "amount" to amount, "method" to method,
                "date" to Pos.str(body["date"]).ifEmpty { now.take(10) },
                "note" to Pos.str(body["note"]), "createdAt" to now,
            )
            sale.listAt("payments").add(payment)
            val noteSuffix = if (Pos.str(payment["note"]).isNotEmpty()) " · ${payment["note"]}" else ""
            store.listAt("transactions").add(0, newDoc(
                "id" to Pos.newId("tx"), "type" to "credit_payment", "itemId" to null,
                "itemName" to "Payment ${sale["invoiceNumber"]}", "quantity" to 0, "amount" to amount,
                "note" to "Payment received ${sale["invoiceNumber"]} — ${sale["customerName"]} · $method$noteSuffix",
                "createdAt" to now,
            ))

            // Mirror the receipt onto the linked Records → Credit entry, if any.
            store["options"].asDocList().firstOrNull { it["saleId"] == sale["id"] }?.let { opt ->
                opt.listAt("payments").add(newDoc(
                    "id" to Pos.newId("pay"), "amount" to amount,
                    "date" to payment["date"],
                    "note" to (method.replaceFirstChar { it.uppercase() } +
                        (if (Pos.str(payment["note"]).isNotEmpty()) " · ${payment["note"]}" else "") + " (via invoice)").trim(),
                    "createdAt" to now,
                ))
                val paidTotal = opt["payments"].asDocList().sumOf { Pos.num(it["amount"]) }
                if (paidTotal >= Pos.num(opt["cost"])) opt["status"] = "closed"
                opt["updatedAt"] = now
            }
            newDoc("payment" to payment, "sale" to Pos.withDueFields(sale))
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(result)
    }

    /** Void a sale: restore stock, tag transactions [VOIDED], revert linked trade-in/scheme. */
    @PostMapping("/api/sales/{id}/void")
    fun voidSale(request: HttpServletRequest, @PathVariable id: String, @RequestBody(required = false) body: Doc?): Any =
        repo.update(request.userId()) { store ->
            val sale = store["sales"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Sale not found.", 404)
            if (Pos.str(sale["status"]) == "voided") throw ApiException("Sale is already voided.")
            if (sale["payments"].asDocList().isNotEmpty()) {
                throw ApiException("Payments have been received against this sale. Settle or refund those first — this invoice can no longer be voided automatically.")
            }
            val reason = Pos.str(body?.get("reason"))
            if (reason.isEmpty()) throw ApiException("A reason is required to void a sale.")
            val now = Pos.nowIso()
            val items = store["items"].asDocList()

            sale["lines"].asDocList().forEach { line ->
                if (line["inventory"] != true || Pos.str(line["itemId"]).isEmpty()) return@forEach
                val item = items.firstOrNull { it["id"] == line["itemId"] } ?: return@forEach
                item["quantity"] = Pos.num(item["quantity"]) + Pos.num(line["quantity"])
                if (Pos.num(item["quantity"]) > 0) item["status"] = "in_stock"
                item["updatedAt"] = now
            }

            val invoiceNumber = Pos.str(sale["invoiceNumber"])
            store["transactions"].asDocList().forEach { tx ->
                val note = tx["note"]?.toString() ?: ""
                if (Pos.str(tx["type"]) == "sale" && note.contains(invoiceNumber) && !note.contains("[VOIDED]")) {
                    tx["note"] = "$note [VOIDED]"
                }
            }
            store.listAt("transactions").add(0, newDoc(
                "id" to Pos.newId("tx"), "type" to "void", "itemId" to null,
                "itemName" to "Void $invoiceNumber", "quantity" to 0,
                "amount" to -Pos.num(sale["total"]),
                "note" to "Void $invoiceNumber — $reason", "createdAt" to now,
            ))

            if (sale["oldGold"] != null) {
                store["oldGoldExchanges"].asDocList().firstOrNull { it["saleId"] == sale["id"] }?.let {
                    it["voided"] = true
                    it["voidedAt"] = now
                }
            }

            if (Pos.str(sale["schemeId"]).isNotEmpty()) {
                store["schemes"].asDocList().firstOrNull {
                    it["id"] == sale["schemeId"] && Pos.str(it["status"]) == "redeemed" && it["saleId"] == sale["id"]
                }?.let { scheme ->
                    scheme["status"] = "active"
                    scheme.remove("redeemedAt"); scheme.remove("redeemedAmount")
                    scheme.remove("saleId"); scheme.remove("invoiceNumber")
                    scheme["updatedAt"] = now
                }
            }

            // Remove the linked Records → Credit entry.
            store.listAt("options").removeAll { it.asDocOrNull()?.get("saleId") == sale["id"] }

            sale["status"] = "voided"
            sale["voidedAt"] = now
            sale["voidReason"] = reason
            sale
        }
}
