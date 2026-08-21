package com.subarnapasal.store

import com.subarnapasal.common.Doc
import com.subarnapasal.common.Pos
import com.subarnapasal.common.asDoc
import com.subarnapasal.common.asDocList
import com.subarnapasal.common.asDocOrNull
import com.subarnapasal.common.listAt
import com.subarnapasal.common.newDoc
import kotlin.math.max
import kotlin.math.min

/** Store-level business logic ported from app/Support/StoreLogic.php. */
object StoreLogic {

    fun getStoreLocations(store: Doc): MutableList<Any?> {
        val locations = store["settings"].asDoc()["locations"] as? List<*>
        if (locations != null && locations.isNotEmpty()) {
            val out = locations.map { Pos.str(it) }.filter { it.isNotEmpty() }
            if (out.isNotEmpty()) return out.toMutableList<Any?>()
        }
        val fromItems = mutableListOf<String>()
        store["items"].asDocList().forEach { i ->
            val loc = Pos.str(i["location"])
            if (loc.isNotEmpty() && loc !in fromItems) fromItems.add(loc)
        }
        if (fromItems.isNotEmpty()) return fromItems.toMutableList<Any?>()
        return mutableListOf<Any?>("Desk A", "Desk B", "Side Desk")
    }

    fun getStoreItemCategories(store: Doc): MutableList<Any?> {
        val cats = store["settings"].asDoc()["itemCategories"] as? List<*>
        if (cats != null && cats.isNotEmpty()) return Pos.normalizeItemCategories(cats)
        return Pos.DEFAULT_ITEM_CATEGORIES.toMutableList<Any?>()
    }

    fun parseCustomerNameFromSaleNote(note: Any?): String {
        val text = note?.toString() ?: ""
        val m = Regex("^POS — ([^·]+)").find(text) ?: return ""
        return m.groupValues[1].trim()
    }

    fun computeCustomerPurchaseCounts(store: Doc): MutableMap<String, Int> {
        val counts = mutableMapOf<String, Int>()
        store["orders"].asDocList().forEach { order ->
            if (Pos.str(order["status"]) != "completed" || Pos.str(order["customerName"]).isEmpty()) return@forEach
            val key = Pos.customerMatchKey(order["customerName"], order["customerPhone"] ?: "")
            counts[key] = (counts[key] ?: 0) + 1
        }
        store["transactions"].asDocList().forEach { tx ->
            if (Pos.str(tx["type"]) != "sale") return@forEach
            val name = parseCustomerNameFromSaleNote(tx["note"])
            if (name.isEmpty()) return@forEach
            val key = Pos.customerMatchKey(name, "")
            counts[key] = (counts[key] ?: 0) + 1
        }
        return counts
    }

    fun syncCustomersFromOrders(store: Doc): Boolean {
        val customers = store.listAt("customers")
        val byKey = customers.asDocList().map { Pos.customerMatchKey(it["name"], it["phone"]) }.toMutableSet()
        var changed = false
        store["orders"].asDocList().forEach { order ->
            val name = Pos.str(order["customerName"])
            if (name.isEmpty()) return@forEach
            val phone = Pos.str(order["customerPhone"])
            val key = Pos.customerMatchKey(name, phone)
            if (key in byKey) return@forEach
            customers.add(newDoc(
                "id" to Pos.newId("c"), "name" to name, "phone" to phone,
                "email" to "", "address" to "",
                "createdAt" to (order["createdAt"] ?: Pos.nowIso()), "purchases" to 0,
            ))
            byKey.add(key)
            changed = true
        }
        return changed
    }

    fun listCustomersWithActivity(store: Doc): List<Doc> {
        syncCustomersFromOrders(store)
        val purchaseCounts = computeCustomerPurchaseCounts(store)
        val list = store["customers"].asDocList().map { customer ->
            val c = LinkedHashMap(customer)
            c["purchases"] = purchaseCounts[Pos.customerMatchKey(customer["name"], customer["phone"])] ?: 0
            c
        }
        return list.sortedWith(
            compareByDescending<Doc> { Pos.num(it["purchases"]).toInt() }
                .thenBy { Pos.str(it["name"]) }
        )
    }

    fun upsertCustomerInStore(store: Doc, payload: Doc): Doc? {
        val name = Pos.str(payload["name"])
        if (name.isEmpty()) return null
        val phone = Pos.str(payload["phone"])
        val email = Pos.str(payload["email"])
        val address = Pos.str(payload["address"])
        val customers = store.listAt("customers")
        val key = Pos.customerMatchKey(name, phone)
        var found: Doc? = null
        for (c in customers) {
            val d = c.asDocOrNull() ?: continue
            if (Pos.customerMatchKey(d["name"], d["phone"]) == key) { found = d; break }
        }
        val customer: Doc
        if (found != null) {
            if (phone.isNotEmpty() && Pos.str(found["phone"]).isEmpty()) found["phone"] = phone
            if (email.isNotEmpty() && Pos.str(found["email"]).isEmpty()) found["email"] = email
            if (address.isNotEmpty() && Pos.str(found["address"]).isEmpty()) found["address"] = address
            customer = found
        } else {
            customer = newDoc(
                "id" to Pos.newId("c"), "name" to name, "phone" to phone,
                "email" to email, "address" to address,
                "createdAt" to Pos.nowIso(), "purchases" to 0,
            )
            customers.add(0, customer)
        }
        return customer
    }

    fun buildOrderLine(item: Doc, quantity: Any?, metals: Doc): Doc {
        val qty = max(1.0, Pos.num(quantity, 1.0))
        val unitPrice = Pos.itemValue(item, metals)
        val jartiWeightGrams = Pos.resolveJartiWeightGrams(
            Pos.num(item["weightGrams"]),
            item["jartiRateType"] ?: "percent",
            Pos.num(item["jartiRateValue"]),
        )
        return newDoc(
            "itemId" to item["id"], "itemName" to item["name"], "sku" to item["sku"],
            "category" to (item["category"] ?: "gold"),
            "quantity" to qty, "unitPrice" to unitPrice, "lineTotal" to unitPrice * qty,
            "weightGrams" to Pos.num(item["weightGrams"]),
            "karat" to (Pos.num(item["karat"]).takeIf { it != 0.0 } ?: 24.0),
            "jartiRateType" to (item["jartiRateType"] ?: "flat"),
            "jartiRateValue" to Pos.num(item["jartiRateValue"]),
            "jartiWeightGrams" to jartiWeightGrams,
        )
    }

    fun buildCustomOrderLine(body: Doc, quantity: Any?, metals: Doc): Doc {
        val custom = body["customItem"].asDocOrNull() ?: linkedMapOf()
        fun pick(vararg keys: String): Any? {
            for (k in keys) {
                if (custom.containsKey(k) && custom[k] != null) return custom[k]
            }
            return null
        }
        val category = Pos.str(custom["category"] ?: body["customCategory"] ?: body["category"] ?: "gold")
            .ifEmpty { "gold" }.lowercase()
        val metal = Pos.itemMetalType(newDoc("category" to category))
        val itemName = Pos.str(custom["name"] ?: body["customItemName"])
        if (metal == "other" && itemName.isEmpty()) throw RuntimeException("Enter a name for Other metal items.")
        val weightGrams = Pos.num(custom["weightGrams"] ?: body["customWeightGrams"])
        val karat = Pos.num(custom["karat"] ?: body["customKarat"]).takeIf { it != 0.0 } ?: 24.0
        val makingCharge = Pos.num(custom["makingCharge"] ?: body["customMakingCharge"])
        val customRatePerTola = Pos.num(custom["customRatePerTola"] ?: body["customRatePerTola"])
        val jartiRateType = Pos.str(custom["jartiRateType"] ?: body["customJartiRateType"] ?: "percent").ifEmpty { "percent" }
        var jartiRateValue = Pos.num(custom["jartiRateValue"] ?: body["customJartiRateValue"])
        var jartiWeightGrams = Pos.num(custom["jartiWeightGrams"])
        if (jartiWeightGrams == 0.0 && jartiRateType != "percent") {
            val jt = Pos.num(custom["jartiTola"] ?: body["customJartiTola"])
            val ja = Pos.num(custom["jartiAana"] ?: body["customJartiAana"])
            val jl = Pos.num(custom["jartiLaal"] ?: body["customJartiLaal"])
            if (jt != 0.0 || ja != 0.0 || jl != 0.0) {
                val totalLaal = jt * Pos.LAAL_PER_TOLA + ja * Pos.LAAL_PER_AANA + jl
                jartiWeightGrams = (totalLaal * Pos.TOLA_GRAMS) / Pos.LAAL_PER_TOLA
            } else {
                jartiWeightGrams = Pos.num(custom["jartiGrams"] ?: body["customJartiGrams"]).takeIf { it != 0.0 } ?: jartiRateValue
            }
        }
        if (jartiWeightGrams == 0.0) jartiWeightGrams = Pos.resolveJartiWeightGrams(weightGrams, jartiRateType, jartiRateValue)
        if (jartiRateType != "percent" && jartiWeightGrams > 0) jartiRateValue = jartiWeightGrams
        val weightUnit = Pos.str(custom["weightUnit"] ?: body["customWeightUnit"] ?: "grams").ifEmpty { "grams" }
        val tolaParts: Doc? = if (weightUnit == "tola") newDoc(
            "tola" to Pos.num(custom["weightTola"] ?: body["customWeightTola"]),
            "aana" to Pos.num(custom["weightAana"] ?: body["customWeightAana"]),
            "laal" to Pos.num(custom["weightLaal"] ?: body["customWeightLaal"]),
        ) else null
        val hasTolaWeight = weightUnit == "tola" && tolaParts != null &&
            (Pos.num(tolaParts["tola"]) != 0.0 || Pos.num(tolaParts["aana"]) != 0.0 || Pos.num(tolaParts["laal"]) != 0.0)
        if (weightUnit == "tola") {
            if (!hasTolaWeight) throw RuntimeException("Weight is required.")
        } else if (weightGrams <= 0) {
            throw RuntimeException("Weight is required.")
        }
        if (metal == "other" && customRatePerTola == 0.0) throw RuntimeException("Enter a rate per tola for Other metal items.")
        val qty = max(1.0, Pos.num(quantity, 1.0))
        val draft = newDoc(
            "category" to category, "karat" to karat, "weightGrams" to weightGrams,
            "makingCharge" to makingCharge, "customRatePerTola" to customRatePerTola,
            "salePrice" to 0, "jartiRateType" to jartiRateType, "jartiRateValue" to jartiRateValue,
        )
        val unitPrice = Pos.calcItemLinePrice(draft, newDoc("weightUnit" to weightUnit, "tolaParts" to tolaParts, "metals" to metals))
        return newDoc(
            "itemId" to "custom-${System.currentTimeMillis()}",
            "itemName" to itemName.ifEmpty { Pos.metalDefaultName(category) },
            "sku" to "CUSTOM", "category" to category, "quantity" to qty,
            "unitPrice" to unitPrice, "lineTotal" to unitPrice * qty, "custom" to true,
            "weightGrams" to weightGrams, "karat" to karat,
            "customRatePerTola" to if (metal == "other") customRatePerTola else 0,
            "jartiRateType" to jartiRateType, "jartiRateValue" to jartiRateValue,
            "jartiWeightGrams" to jartiWeightGrams,
        )
    }

    fun nextOrderNumber(store: Doc): String {
        val nums = store["orders"].asDocList().mapNotNull { o ->
            val n = (o["orderNumber"]?.toString() ?: "").replace(Regex("\\D"), "")
            n.toLongOrNull()
        }
        val next = (nums.maxOrNull() ?: 1000L) + 1
        return "SP-$next"
    }

    fun applyOrderCompletion(store: Doc, order: Doc) {
        val items = store["items"].asDocList()
        order["lines"].asDocList().forEach { line ->
            val item = items.firstOrNull { it["id"] == line["itemId"] } ?: return@forEach
            if (Pos.num(item["quantity"]) < Pos.num(line["quantity"])) {
                throw RuntimeException("Not enough stock for ${item["name"]}.")
            }
            item["quantity"] = Pos.num(item["quantity"]) - Pos.num(line["quantity"])
            if (Pos.num(item["quantity"]) == 0.0) item["status"] = "sold_out"
            item["updatedAt"] = Pos.nowIso()
            store.listAt("transactions").add(0, newDoc(
                "id" to Pos.newId("tx"), "type" to "sale", "itemId" to item["id"], "itemName" to item["name"],
                "quantity" to line["quantity"], "amount" to (line["lineTotal"] ?: 0),
                "note" to "Order ${order["orderNumber"]} — ${order["customerName"]}",
                "createdAt" to Pos.nowIso(),
            ))
        }
    }

    fun revertOrderCompletion(store: Doc, order: Doc) {
        val orderRef = "Order ${order["orderNumber"]}"
        val items = store["items"].asDocList()
        order["lines"].asDocList().forEach { line ->
            val item = items.firstOrNull { it["id"] == line["itemId"] } ?: return@forEach
            item["quantity"] = Pos.num(item["quantity"]) + Pos.num(line["quantity"])
            if (Pos.num(item["quantity"]) > 0) item["status"] = "in_stock"
            item["updatedAt"] = Pos.nowIso()
        }
        val filtered = store["transactions"].asDocList().filterNot { tx ->
            Pos.str(tx["type"]) == "sale" && (tx["note"]?.toString() ?: "").contains(orderRef)
        }
        store["transactions"] = filtered.toMutableList<Any?>()
    }

    fun txAmount(store: Doc, tx: Doc): Double {
        if (tx["amount"] != null && Pos.numOrNull(tx["amount"]) != null) return Pos.num(tx["amount"])
        store["items"].asDocList().forEach { item ->
            if (item["id"] == tx["itemId"]) {
                return Pos.itemValue(item, store["settings"].asDoc()).toDouble() * Pos.num(tx["quantity"])
            }
        }
        return 0.0
    }

    // ── counters ─────────────────────────────────────────────────────────

    private fun nextCounter(store: Doc, key: String, prefix: String, pad: Int): String {
        val settings = store["settings"].asDoc()
        val n = Pos.num(settings[key]).toLong() + 1
        settings[key] = n
        return prefix + n.toString().padStart(pad, '0')
    }

    fun nextInvoiceNumber(store: Doc): String = nextCounter(store, "invoiceCounter", "INV-", 6)
    fun nextRepairNumber(store: Doc): String = nextCounter(store, "repairCounter", "REP-", 4)
    fun nextRequestNumber(store: Doc): String = nextCounter(store, "requestCounter", "REQ-", 4)
    fun nextSchemeNumber(store: Doc): String = nextCounter(store, "schemeCounter", "GS-", 4)

    // ── reports ──────────────────────────────────────────────────────────

    fun buildReports(store: Doc, start: String?, end: String?): Doc {
        val metals = Pos.resolveMetalRates(store)
        val allItems = store["items"].asDocList()
        val inStock = allItems.filter { Pos.str(it["status"]) == "in_stock" && Pos.num(it["quantity"]) > 0 }
        var totalWeight = 0.0
        var totalValue = 0.0
        inStock.forEach { i ->
            totalWeight += Pos.num(i["weightGrams"]) * Pos.num(i["quantity"])
            totalValue += Pos.itemValue(i, metals) * Pos.num(i["quantity"])
        }
        val lowStock = allItems.filter { Pos.str(it["status"]) == "in_stock" && Pos.num(it["quantity"]) <= 1 }
        val transactions = store["transactions"].asDocList()
            .filter { Pos.inDateRange(it["createdAt"], start, end) }
            .map { tx -> LinkedHashMap(tx).also { it["amount"] = txAmount(store, tx) } }
            .sortedByDescending { it["createdAt"]?.toString() ?: "" }
        val orders = store["orders"].asDocList()
            .filter { Pos.inDateRange(it["createdAt"], start, end) }
            .sortedByDescending { it["createdAt"]?.toString() ?: "" }
        val saleTx = transactions.filter {
            Pos.str(it["type"]) == "sale" && !(it["note"]?.toString() ?: "").contains("[VOIDED]")
        }
        val salesRevenue = saleTx.sumOf { Pos.num(it["amount"]) }
        val completedOrders = orders.filter { Pos.str(it["status"]) == "completed" }
        val orderRevenue = completedOrders.sumOf { Pos.num(it["totalAmount"]) }
        val pendingOrders = orders.count { Pos.str(it["status"]) in listOf("pending", "confirmed", "progress", "ready") }
        val salesByDay = sortedMapOf<String, Double>()
        saleTx.forEach { tx ->
            val day = (tx["createdAt"]?.toString() ?: "").take(10)
            salesByDay[day] = (salesByDay[day] ?: 0.0) + Pos.num(tx["amount"])
        }
        val customerOrderTotals = linkedMapOf<String, Doc>()
        orders.forEach { order ->
            val key = Pos.str(order["customerName"]).ifEmpty { "Unknown" }
            val entry = customerOrderTotals.getOrPut(key) {
                newDoc("name" to key, "phone" to (order["customerPhone"] ?: ""), "orders" to 0, "total" to 0.0)
            }
            entry["orders"] = Pos.num(entry["orders"]).toInt() + 1
            if (Pos.str(order["status"]) == "completed") {
                entry["total"] = Pos.num(entry["total"]) + Pos.num(order["totalAmount"])
            }
        }
        val topCustomers = customerOrderTotals.values.sortedByDescending { Pos.num(it["total"]) }.take(10)
        val categoryCounts = linkedMapOf<String, Double>()
        var totalItems = 0.0
        inStock.forEach { i ->
            val cat = Pos.str(i["category"])
            categoryCounts[cat] = (categoryCounts[cat] ?: 0.0) + Pos.num(i["quantity"])
            totalItems += Pos.num(i["quantity"])
        }
        return newDoc(
            "period" to newDoc("start" to start, "end" to end),
            "goldRatePerTola" to metals["goldRatePerTola"],
            "goldRatePerTolaNpr" to metals["goldRatePerTola"],
            "metalRatesLive" to metals["live"], "metalCurrency" to metals["currency"],
            "currency" to (store["settings"].asDoc()["currency"] ?: "NPR"),
            "sales" to newDoc(
                "revenue" to salesRevenue, "salesCount" to saleTx.size,
                "orderRevenue" to orderRevenue, "completedOrders" to completedOrders.size,
                "pendingOrders" to pendingOrders, "totalOrders" to orders.size,
                "salesByDay" to salesByDay.map { (date, amount) -> newDoc("date" to date, "amount" to amount) },
                "transactions" to saleTx,
            ),
            "inventory" to newDoc(
                "totalItems" to totalItems, "uniqueSkus" to inStock.size,
                "totalWeightGrams" to Pos.round2(totalWeight), "totalWeightTola" to Pos.gramsToTola(totalWeight),
                "totalInventoryValue" to totalValue, "lowStockCount" to lowStock.size,
                "lowStock" to lowStock, "categoryCounts" to categoryCounts,
                "movements" to transactions,
            ),
            "customers" to newDoc(
                "totalCustomers" to topCustomers.size,
                "activeBuyers" to topCustomers.count { Pos.num(it["total"]) > 0 },
                "topCustomers" to topCustomers, "recentOrders" to orders.take(10),
            ),
        )
    }
}
