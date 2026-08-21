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
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import kotlin.math.max

@RestController
class ItemController(private val repo: StoreRepository) {

    companion object {
        fun nextItemNumber(store: Doc): String {
            val settings = store["settings"].asDoc()
            val n = Pos.num(settings["itemCounter"]).toLong() + 1
            settings["itemCounter"] = n
            return "ITM-" + n.toString().padStart(4, '0')
        }
    }

    @GetMapping("/api/items")
    fun index(
        request: HttpServletRequest,
        @RequestParam(required = false) q: String?,
        @RequestParam(required = false) category: String?,
        @RequestParam(required = false) status: String?,
    ): Any = repo.update(request.userId()) { store ->
        // One-time backfill: give every existing item a unique number.
        val itemsList = store["items"].asDocList()
        for (i in itemsList.indices.reversed()) {
            if (Pos.str(itemsList[i]["itemNumber"]).isEmpty()) {
                itemsList[i]["itemNumber"] = nextItemNumber(store)
            }
        }
        var items = itemsList.toList()
        if (!q.isNullOrEmpty()) {
            val term = q.lowercase()
            items = items.filter { i ->
                listOf("name", "sku", "itemNumber", "location", "notes")
                    .any { Pos.str(i[it]).lowercase().contains(term) }
            }
        }
        if (!category.isNullOrEmpty()) items = items.filter { Pos.str(it["category"]) == category }
        if (!status.isNullOrEmpty()) items = items.filter { Pos.str(it["status"]) == status }
        items = items.sortedByDescending { it["updatedAt"]?.toString() ?: "" }
        val metals = Pos.resolveMetalRates(store)
        newDoc(
            "items" to items,
            "goldRatePerTola" to metals["goldRatePerTola"],
            "silverRatePerTola" to metals["silverRatePerTola"],
            "metalRatesLive" to metals["live"], "metalCurrency" to metals["currency"],
            "metalRatesError" to metals["liveError"],
        )
    }

    @GetMapping("/api/items/{id}")
    fun show(request: HttpServletRequest, @PathVariable id: String): Any {
        val store = repo.read(request.userId())
        return store["items"].asDocList().firstOrNull { it["id"] == id }
            ?: throw ApiException("Item not found.", 404)
    }

    @PostMapping("/api/items")
    fun create(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val item = repo.update(request.userId()) { store ->
            if (Pos.str(body["name"]).isEmpty() || Pos.str(body["sku"]).isEmpty()) {
                throw ApiException("Name and SKU are required.")
            }
            Pos.validateInventoryMetalFields(body)?.let { throw ApiException(it) }
            val items = store.listAt("items")
            if (items.asDocList().any { it["sku"] == body["sku"] }) throw ApiException("SKU already exists.")
            val now = Pos.nowIso()
            val item = Pos.normalizeItemRecord(newDoc(
                "id" to Pos.newId("sp"),
                "sku" to Pos.str(body["sku"]), "name" to Pos.str(body["name"]),
                "category" to (body["category"] ?: "gold"),
                "karat" to (Pos.num(body["karat"]).takeIf { it != 0.0 } ?: 24.0),
                "weightGrams" to Pos.num(body["weightGrams"]),
                "weightUnit" to if (body["weightUnit"] == "tola") "tola" else "grams",
                "makingCharge" to Pos.num(body["makingCharge"]),
                "jartiRateType" to Pos.str(body["jartiRateType"] ?: "flat").ifEmpty { "flat" },
                "jartiRateValue" to Pos.num(body["jartiRateValue"]),
                "hallmarkNumber" to Pos.str(body["hallmarkNumber"]),
                "hallmarkDate" to Pos.str(body["hallmarkDate"]),
                "purchaseCost" to Pos.num(body["purchaseCost"]),
                "salePrice" to Pos.num(body["salePrice"]),
                "customRatePerTola" to Pos.num(body["customRatePerTola"]),
                "quantity" to max(0.0, Pos.num(body["quantity"])),
                "status" to (body["status"] ?: "in_stock"),
                "location" to Pos.str(body["location"]),
                "hallmark" to (body["hallmark"] != null && body["hallmark"] != false && body["hallmark"] != 0 && body["hallmark"] != ""),
                "notes" to Pos.str(body["notes"]),
                "hsCode" to Pos.str(body["hsCode"]),
                "stoneAmount" to max(0.0, Math.round(Pos.num(body["stoneAmount"])).toDouble()),
                "createdAt" to now, "updatedAt" to now,
            ), true)
            item["itemNumber"] = nextItemNumber(store)
            items.add(0, item)
            item
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(item)
    }

    @PutMapping("/api/items/{id}")
    fun update(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): Any =
        repo.update(request.userId()) { store ->
            val items = store.listAt("items")
            val docList = items.asDocList()
            val idx = docList.indexOfFirst { it["id"] == id }
            if (idx < 0) throw ApiException("Item not found.", 404)
            val existing = docList[idx]
            if (Pos.isItemSoldOut(existing)) throw ApiException("Sold out items cannot be edited.")
            if (Pos.str(body["sku"]).isNotEmpty() && body["sku"] != existing["sku"]) {
                if (docList.any { it["sku"] == body["sku"] }) throw ApiException("SKU already exists.")
            }
            val name = if (body["name"] != null) Pos.str(body["name"]) else Pos.str(existing["name"])
            if (name.isEmpty()) throw ApiException("Name is required.")
            Pos.validateInventoryMetalFields(newDoc(
                "category" to (body["category"] ?: existing["category"]),
                "customRatePerTola" to (body["customRatePerTola"] ?: existing["customRatePerTola"] ?: 0),
            ))?.let { throw ApiException(it) }
            fun keep(key: String, transform: (Any?) -> Any? = { it }): Any? =
                if (body[key] != null) transform(body[key]) else existing[key]
            val updated = Pos.normalizeItemRecord(newDoc(
                "id" to existing["id"],
                "sku" to keep("sku") { Pos.str(it) },
                "name" to name,
                "category" to (body["category"] ?: existing["category"]),
                "karat" to if (body["karat"] != null) (Pos.num(body["karat"]).takeIf { it != 0.0 } ?: Pos.num(existing["karat"])) else existing["karat"],
                "weightGrams" to keep("weightGrams") { Pos.num(it) },
                "weightUnit" to if (body["weightUnit"] != null) (if (body["weightUnit"] == "tola") "tola" else "grams") else (existing["weightUnit"] ?: "grams"),
                "makingCharge" to keep("makingCharge") { Pos.num(it) },
                "jartiRateType" to if (body["jartiRateType"] != null) Pos.str(body["jartiRateType"]) else (existing["jartiRateType"] ?: "flat"),
                "jartiRateValue" to if (body["jartiRateValue"] != null) Pos.num(body["jartiRateValue"]) else (existing["jartiRateValue"] ?: 0),
                "hallmarkNumber" to if (body["hallmarkNumber"] != null) Pos.str(body["hallmarkNumber"]) else (existing["hallmarkNumber"] ?: ""),
                "hallmarkDate" to if (body["hallmarkDate"] != null) Pos.str(body["hallmarkDate"]) else (existing["hallmarkDate"] ?: ""),
                "purchaseCost" to keep("purchaseCost") { Pos.num(it) },
                "salePrice" to if (body["salePrice"] != null) Pos.num(body["salePrice"]) else (existing["salePrice"] ?: 0),
                "customRatePerTola" to if (body["customRatePerTola"] != null) Pos.num(body["customRatePerTola"]) else (existing["customRatePerTola"] ?: 0),
                "quantity" to keep("quantity") { Pos.num(it) },
                "status" to (body["status"] ?: existing["status"]),
                "location" to if (body["location"] != null) Pos.str(body["location"]) else (existing["location"] ?: ""),
                "hallmark" to if (body["hallmark"] != null) (body["hallmark"] == true) else existing["hallmark"],
                "notes" to if (body["notes"] != null) Pos.str(body["notes"]) else (existing["notes"] ?: ""),
                "hsCode" to if (body["hsCode"] != null) Pos.str(body["hsCode"]) else (existing["hsCode"] ?: ""),
                "stoneAmount" to if (body["stoneAmount"] != null) max(0.0, Math.round(Pos.num(body["stoneAmount"])).toDouble()) else (existing["stoneAmount"] ?: 0),
                "createdAt" to existing["createdAt"], "updatedAt" to Pos.nowIso(),
            ))
            updated["itemNumber"] = existing["itemNumber"] ?: ""
            // Replace at the same position in the raw list.
            val rawIdx = items.indexOfFirst { it.asDocOrNull()?.get("id") == id }
            items[rawIdx] = updated
            updated
        }

    @DeleteMapping("/api/items/{id}")
    fun destroy(request: HttpServletRequest, @PathVariable id: String): Any =
        repo.update(request.userId()) { store ->
            val items = store.listAt("items")
            val before = items.size
            items.removeAll { it.asDocOrNull()?.get("id") == id }
            if (items.size == before) throw ApiException("Item not found.", 404)
            mapOf("ok" to true)
        }
}

@RestController
class TransactionController(private val repo: StoreRepository) {

    @GetMapping("/api/transactions")
    fun index(request: HttpServletRequest): Any {
        val store = repo.read(request.userId())
        val txs = store["transactions"].asDocList().sortedByDescending { it["createdAt"]?.toString() ?: "" }
        return mapOf("transactions" to txs)
    }

    @PostMapping("/api/transactions")
    fun create(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val result = repo.update(request.userId()) { store ->
            val type = body["type"]
            val quantity = body["quantity"]
            val note = body["note"] ?: ""
            if (body["customItem"] != null && body["customItem"] != false) {
                val itemName = Pos.str(body["itemName"])
                val qty = max(1.0, Pos.num(quantity).takeIf { it != 0.0 } ?: 1.0)
                val amount = Pos.numOrNull(body["amount"])
                if (itemName.isEmpty()) throw ApiException("Item name is required for custom sales.")
                if (amount == null || amount < 0) throw ApiException("A valid amount is required for custom sales.")
                val tx = newDoc(
                    "id" to Pos.newId("tx"), "type" to "sale", "itemId" to null, "itemName" to itemName,
                    "quantity" to qty, "amount" to amount, "note" to Pos.str(note), "createdAt" to Pos.nowIso(),
                )
                store.listAt("transactions").add(0, tx)
                return@update newDoc("transaction" to tx)
            }
            val itemId = body["itemId"]
            if (type == null || itemId == null || quantity == null) throw ApiException("Type, item, and quantity are required.")
            val item = store["items"].asDocList().firstOrNull { it["id"] == itemId }
                ?: throw ApiException("Item not found.", 404)
            val qty = max(1.0, Pos.num(quantity, 1.0))
            when (type) {
                "stock_in" -> {
                    item["quantity"] = Pos.num(item["quantity"]) + qty
                    item["status"] = "in_stock"
                }
                "sale", "stock_out" -> {
                    if (Pos.num(item["quantity"]) < qty) throw ApiException("Not enough stock.")
                    item["quantity"] = Pos.num(item["quantity"]) - qty
                    if (Pos.num(item["quantity"]) == 0.0) item["status"] = "sold_out"
                }
                else -> throw ApiException("Invalid transaction type.")
            }
            item["updatedAt"] = Pos.nowIso()
            val metals = Pos.resolveMetalRates(store)
            val amount = if (type == "sale") Pos.itemValue(item, metals) * qty else 0.0
            val tx = newDoc(
                "id" to Pos.newId("tx"), "type" to type, "itemId" to item["id"], "itemName" to item["name"],
                "quantity" to qty, "amount" to amount, "note" to Pos.str(note), "createdAt" to Pos.nowIso(),
            )
            store.listAt("transactions").add(0, tx)
            newDoc("transaction" to tx, "item" to item)
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(result)
    }
}

@RestController
class OldGoldController(private val repo: StoreRepository) {

    @GetMapping("/api/old-gold")
    fun index(request: HttpServletRequest): Any {
        val store = repo.read(request.userId())
        val exchanges = store["oldGoldExchanges"].asDocList().sortedByDescending { it["createdAt"]?.toString() ?: "" }
        return mapOf("exchanges" to exchanges)
    }

    @PostMapping("/api/old-gold")
    fun create(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val exchange = repo.update(request.userId()) { store ->
            val customerName = Pos.str(body["customerName"])
            val weightGrams = Pos.num(body["weightGrams"])
            val karat = Pos.num(body["karat"]).takeIf { it != 0.0 } ?: 22.0
            val ratePerTola = Pos.num(body["ratePerTola"])
            if (customerName.isEmpty()) throw ApiException("Customer name is required.")
            if (weightGrams <= 0) throw ApiException("Weight must be greater than 0.")
            val buyValue = Math.round((weightGrams / Pos.TOLA_GRAMS) * ratePerTola * (karat / 24.0))
            val now = Pos.nowIso()
            val exchange = newDoc(
                "id" to Pos.newId("og"), "customerName" to customerName,
                "customerPhone" to Pos.str(body["customerPhone"]),
                "weightGrams" to weightGrams, "karat" to karat, "ratePerTola" to ratePerTola,
                "buyValue" to buyValue,
                "description" to Pos.str(body["description"]),
                "date" to Pos.str(body["date"]).ifEmpty { now.take(10) }, "createdAt" to now,
            )
            store.listAt("oldGoldExchanges").add(0, exchange)
            StoreLogic.upsertCustomerInStore(store, newDoc("name" to customerName, "phone" to exchange["customerPhone"]))
            exchange
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(exchange)
    }

    @DeleteMapping("/api/old-gold/{id}")
    fun destroy(request: HttpServletRequest, @PathVariable id: String): Any =
        repo.update(request.userId()) { store ->
            val list = store.listAt("oldGoldExchanges")
            val before = list.size
            list.removeAll { it.asDocOrNull()?.get("id") == id }
            if (list.size == before) throw ApiException("Exchange not found.", 404)
            mapOf("ok" to true)
        }
}
