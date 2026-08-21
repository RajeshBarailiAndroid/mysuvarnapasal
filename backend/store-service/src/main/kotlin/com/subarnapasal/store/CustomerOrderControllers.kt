package com.subarnapasal.store

import com.subarnapasal.common.ApiException
import com.subarnapasal.common.Doc
import com.subarnapasal.common.Pos
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
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import kotlin.math.max

@RestController
class CustomerController(private val repo: StoreRepository) {

    @GetMapping("/api/customers")
    fun index(request: HttpServletRequest): Any = repo.update(request.userId()) { store ->
        mapOf("customers" to StoreLogic.listCustomersWithActivity(store))
    }

    @PostMapping("/api/customers")
    fun create(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val result = repo.update(request.userId()) { store ->
            val name = Pos.str(body["name"])
            if (name.isEmpty()) throw ApiException("Customer name is required.")
            Pos.validateCustomerPhone(body["phone"], body["phoneRegion"])?.let { throw ApiException(it) }
            val customer = StoreLogic.upsertCustomerInStore(store, body)!!
            val purchaseCounts = StoreLogic.computeCustomerPurchaseCounts(store)
            val out = LinkedHashMap(customer)
            out["purchases"] = purchaseCounts[Pos.customerMatchKey(customer["name"], customer["phone"])] ?: 0
            newDoc("customer" to out, "customers" to StoreLogic.listCustomersWithActivity(store))
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(result)
    }

    @PostMapping("/api/customers/upsert")
    fun upsert(request: HttpServletRequest, @RequestBody body: Doc): Any = repo.update(request.userId()) { store ->
        Pos.validateCustomerPhone(body["phone"], body["phoneRegion"])?.let { throw ApiException(it) }
        val customer = StoreLogic.upsertCustomerInStore(store, body) ?: throw ApiException("Customer name is required.")
        newDoc("customer" to customer, "customers" to StoreLogic.listCustomersWithActivity(store))
    }

    @DeleteMapping("/api/customers/{id}")
    fun destroy(request: HttpServletRequest, @PathVariable id: String): Any = repo.update(request.userId()) { store ->
        val customers = store.listAt("customers")
        val before = customers.size
        customers.removeAll { it.asDocOrNull()?.get("id") == id }
        if (customers.size == before) throw ApiException("Customer not found.", 404)
        mapOf("customers" to StoreLogic.listCustomersWithActivity(store))
    }
}

@RestController
class OrderController(private val repo: StoreRepository) {

    private val allowedStatuses = listOf("pending", "confirmed", "progress", "ready", "completed", "cancelled")

    @GetMapping("/api/orders")
    fun index(request: HttpServletRequest, @RequestParam(required = false) status: String?): Any {
        val store = repo.read(request.userId())
        var orders = store["orders"].asDocList().toList()
        if (!status.isNullOrEmpty()) orders = orders.filter { Pos.str(it["status"]) == status }
        orders = orders.sortedByDescending { it["createdAt"]?.toString() ?: "" }
        val metals = Pos.resolveMetalRates(store)
        return newDoc(
            "orders" to orders, "goldRatePerTola" to metals["goldRatePerTola"],
            "metalRatesLive" to metals["live"], "metalCurrency" to metals["currency"],
        )
    }

    @GetMapping("/api/orders/{id}")
    fun show(request: HttpServletRequest, @PathVariable id: String): Any {
        val store = repo.read(request.userId())
        return store["orders"].asDocList().firstOrNull { it["id"] == id }
            ?: throw ApiException("Order not found.", 404)
    }

    @PostMapping("/api/orders")
    fun create(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val order = repo.update(request.userId()) { store ->
            val customerName = Pos.str(body["customerName"])
            val quantity = max(1.0, Pos.num(body["quantity"]).takeIf { it != 0.0 } ?: 1.0)
            if (customerName.isEmpty()) throw ApiException("Customer name is required.")
            val metals = Pos.resolveMetalRates(store)
            val now = Pos.nowIso()
            val line: Doc
            if (body["orderItemMode"] == "custom" || (body["customItem"] != null && body["customItem"] != false)) {
                line = try {
                    StoreLogic.buildCustomOrderLine(body, quantity, metals)
                } catch (e: RuntimeException) {
                    throw ApiException(e.message ?: "Invalid custom item.")
                }
            } else {
                val itemId = Pos.str(body["itemId"])
                if (itemId.isEmpty()) throw ApiException("Item is required.")
                val item = store["items"].asDocList().firstOrNull { it["id"] == itemId }
                    ?: throw ApiException("Item not found.", 404)
                if (Pos.num(item["quantity"]) < quantity) throw ApiException("Not enough stock for this order.")
                line = StoreLogic.buildOrderLine(item, quantity, metals)
            }

            // ── Gold source: store gold / customer's own gold / partial ──
            val goldSource = if (Pos.str(body["goldSource"] ?: "store") in listOf("store", "customer", "partial"))
                Pos.str(body["goldSource"] ?: "store") else "store"
            var orderTotal = Pos.num(line["lineTotal"])
            var goldCreditValue = 0L
            var autoGoldAdded: Double? = null
            if (goldSource != "store") {
                val unitWeight = Pos.num(line["weightGrams"])
                val jartiWeight = Pos.num(line["jartiWeightGrams"])
                val qty = max(1.0, Pos.num(line["quantity"], 1.0))
                val totalWeight = (unitWeight + jartiWeight) * qty
                val customerGold = max(0.0, Pos.num(body["customerGoldGrams"]))
                val creditGrams = Math.min(customerGold, totalWeight)
                val slug = Pos.str(line["category"] ?: "gold").ifEmpty { "gold" }.lowercase()
                var rate = Pos.num(line["ratePerTola"])
                if (rate <= 0) {
                    rate = if (slug == "silver") Pos.num(metals["silverRatePerTola"]) else Pos.num(metals["goldRatePerTola"])
                }
                val kf = if (slug == "gold") (Pos.num(line["karat"]).takeIf { it != 0.0 } ?: 24.0) / 24.0 else 1.0
                goldCreditValue = Math.round((creditGrams / Pos.TOLA_GRAMS) * rate * kf)
                orderTotal = max(0.0, orderTotal - goldCreditValue)
                autoGoldAdded = max(0.0, totalWeight - creditGrams)
            }

            fun has(key: String): Boolean = body[key] != null && body[key] != ""
            val hasAdvance = has("advanceAmount")
            val hasCustomerGold = has("customerGoldGrams")
            val hasGoldAdded = has("goldAddedGrams")
            val hasRemaining = has("remainingPayment")
            val advanceAmount = if (hasAdvance) Pos.num(body["advanceAmount"]) else 0.0
            val customerGoldGrams = if (hasCustomerGold) Pos.num(body["customerGoldGrams"]) else 0.0
            val goldAddedGrams = if (hasGoldAdded) Pos.num(body["goldAddedGrams"]) else 0.0
            val advancePaid = body["advancePaid"] == true
            val hasPaymentInfo = hasAdvance || advancePaid || hasCustomerGold || hasGoldAdded || hasRemaining
            var remainingPayment: Double? = null
            if (hasRemaining) {
                remainingPayment = Pos.numOrNull(body["remainingPayment"]) ?: max(0.0, orderTotal - advanceAmount)
            } else if (hasPaymentInfo || goldSource != "store") {
                remainingPayment = max(0.0, orderTotal - advanceAmount)
            }
            val order = newDoc(
                "id" to Pos.newId("ord"), "orderNumber" to StoreLogic.nextOrderNumber(store),
                "customerName" to customerName, "customerPhone" to Pos.str(body["customerPhone"]),
                "status" to "pending", "lines" to mutableListOf<Any?>(line),
                "totalAmount" to orderTotal, "note" to Pos.str(body["note"]),
                "goldSource" to goldSource, "goldCreditValue" to goldCreditValue,
                "karigarId" to Pos.str(body["karigarId"]).ifEmpty { null },
                "karigarName" to Pos.str(body["karigarName"]),
                "advanceAmount" to advanceAmount, "advancePaid" to advancePaid,
                "customerGoldGrams" to customerGoldGrams,
                "goldAddedGrams" to if (autoGoldAdded != null && !hasGoldAdded) autoGoldAdded else goldAddedGrams,
                "remainingPayment" to remainingPayment,
                "createdAt" to now, "updatedAt" to now,
            )
            StoreLogic.upsertCustomerInStore(store, newDoc("name" to customerName, "phone" to order["customerPhone"]))
            store.listAt("orders").add(0, order)
            order
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(order)
    }

    @PatchMapping("/api/orders/{id}")
    fun update(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): Any =
        repo.update(request.userId()) { store ->
            val order = store["orders"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Order not found.", 404)
            val nextStatus = Pos.str(body["status"] ?: order["status"])
            if (nextStatus !in allowedStatuses) throw ApiException("Invalid order status.")
            if (nextStatus == "completed" && Pos.str(order["status"]) != "completed") {
                try {
                    StoreLogic.applyOrderCompletion(store, order)
                } catch (e: RuntimeException) {
                    throw ApiException(e.message ?: "Cannot complete order.")
                }
            } else if (nextStatus != "completed" && Pos.str(order["status"]) == "completed") {
                StoreLogic.revertOrderCompletion(store, order)
            }
            if (body["customerName"] != null) order["customerName"] = Pos.str(body["customerName"])
            if (body["customerPhone"] != null) order["customerPhone"] = Pos.str(body["customerPhone"])
            if (body["note"] != null) order["note"] = Pos.str(body["note"])
            if (body.containsKey("karigarId")) order["karigarId"] = Pos.str(body["karigarId"]).ifEmpty { null }
            if (body["karigarName"] != null) order["karigarName"] = Pos.str(body["karigarName"])
            if (body["advanceAmount"] != null) order["advanceAmount"] = if (body["advanceAmount"] == "") 0.0 else Pos.num(body["advanceAmount"])
            if (body["advancePaid"] != null) order["advancePaid"] = body["advancePaid"] == true
            if (body["customerGoldGrams"] != null) order["customerGoldGrams"] = if (body["customerGoldGrams"] == "") 0.0 else Pos.num(body["customerGoldGrams"])
            if (body["goldAddedGrams"] != null) order["goldAddedGrams"] = if (body["goldAddedGrams"] == "") 0.0 else Pos.num(body["goldAddedGrams"])
            if (body["remainingPayment"] != null) {
                order["remainingPayment"] = if (body["remainingPayment"] == "") {
                    max(0.0, Pos.num(order["totalAmount"]) - Pos.num(order["advanceAmount"]))
                } else {
                    Pos.numOrNull(body["remainingPayment"]) ?: 0.0
                }
            }
            order["status"] = nextStatus
            order["updatedAt"] = Pos.nowIso()
            order
        }

    @DeleteMapping("/api/orders/{id}")
    fun destroy(request: HttpServletRequest, @PathVariable id: String): Any =
        repo.update(request.userId()) { store ->
            val order = store["orders"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Order not found.", 404)
            if (Pos.str(order["status"]) == "completed") StoreLogic.revertOrderCompletion(store, order)
            store.listAt("orders").removeAll { it.asDocOrNull()?.get("id") == id }
            mapOf("ok" to true)
        }
}

@RestController
class KarigarController(private val repo: StoreRepository) {

    @GetMapping("/api/karigar")
    fun index(request: HttpServletRequest): Any =
        mapOf("karigars" to repo.read(request.userId())["karigars"].asDocList())

    @PostMapping("/api/karigar")
    fun create(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val karigar = repo.update(request.userId()) { store ->
            val name = Pos.str(body["name"])
            if (name.isEmpty()) throw ApiException("Karigar name is required.")
            val now = Pos.nowIso()
            val karigar = newDoc(
                "id" to Pos.newId("kg"), "name" to name, "phone" to Pos.str(body["phone"]),
                "specialty" to Pos.str(body["specialty"]),
                "address" to Pos.str(body["address"]),
                "notes" to Pos.str(body["notes"]),
                "goldIssuedGrams" to 0, "goldReturnedGrams" to 0, "goldWastageGrams" to 0,
                "active" to if (body["active"] == null) true else body["active"] == true,
                "createdAt" to now, "updatedAt" to now,
            )
            store.listAt("karigars").add(0, karigar)
            karigar
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(karigar)
    }

    @PutMapping("/api/karigar/{id}")
    fun update(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): Any =
        repo.update(request.userId()) { store ->
            val karigar = store["karigars"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Karigar not found.", 404)
            if (body["name"] != null) karigar["name"] = Pos.str(body["name"])
            if (body["phone"] != null) karigar["phone"] = Pos.str(body["phone"])
            if (body["specialty"] != null) karigar["specialty"] = Pos.str(body["specialty"])
            if (body["address"] != null) karigar["address"] = Pos.str(body["address"])
            if (body["notes"] != null) karigar["notes"] = Pos.str(body["notes"])
            if (body["active"] != null) karigar["active"] = body["active"] == true
            karigar["updatedAt"] = Pos.nowIso()
            karigar
        }

    @DeleteMapping("/api/karigar/{id}")
    fun destroy(request: HttpServletRequest, @PathVariable id: String): Any =
        repo.update(request.userId()) { store ->
            val karigars = store.listAt("karigars")
            val before = karigars.size
            karigars.removeAll { it.asDocOrNull()?.get("id") == id }
            if (karigars.size == before) throw ApiException("Karigar not found.", 404)
            mapOf("ok" to true)
        }

    @PostMapping("/api/karigar/{id}/issue-gold")
    fun issueGold(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): ResponseEntity<Any> =
        goldEntry(request, id, body, "issue")

    @PostMapping("/api/karigar/{id}/return-gold")
    fun returnGold(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): ResponseEntity<Any> =
        goldEntry(request, id, body, "return")

    private fun goldEntry(request: HttpServletRequest, id: String, body: Doc, type: String): ResponseEntity<Any> {
        val result = repo.update(request.userId()) { store ->
            val karigar = store["karigars"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Karigar not found.", 404)
            val weightGrams = Pos.num(body["weightGrams"])
            val wastageGrams = Pos.num(body["wastageGrams"])
            if (weightGrams <= 0) {
                throw ApiException(if (type == "issue") "Weight must be greater than 0." else "Returned weight must be greater than 0.")
            }
            val now = Pos.nowIso()
            val entry = newDoc(
                "id" to Pos.newId("gl"), "karigarId" to karigar["id"], "karigarName" to karigar["name"],
                "type" to type, "weightGrams" to weightGrams,
                "karat" to (Pos.num(body["karat"]).takeIf { it != 0.0 } ?: 24.0),
                "description" to Pos.str(body["description"]),
                "date" to Pos.str(body["date"]).ifEmpty { now.take(10) }, "createdAt" to now,
            )
            if (type == "issue") {
                karigar["goldIssuedGrams"] = Pos.num(karigar["goldIssuedGrams"]) + weightGrams
            } else {
                entry["wastageGrams"] = wastageGrams
                karigar["goldReturnedGrams"] = Pos.num(karigar["goldReturnedGrams"]) + weightGrams
                karigar["goldWastageGrams"] = Pos.num(karigar["goldWastageGrams"]) + wastageGrams
            }
            karigar["updatedAt"] = now
            store.listAt("goldLedger").add(0, entry)
            newDoc("entry" to entry, "karigar" to karigar)
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(result)
    }

    @GetMapping("/api/gold-ledger")
    fun goldLedger(request: HttpServletRequest, @RequestParam(required = false) karigarId: String?): Any {
        val store = repo.read(request.userId())
        var ledger = store["goldLedger"].asDocList().sortedByDescending { it["createdAt"]?.toString() ?: "" }
        if (!karigarId.isNullOrEmpty()) ledger = ledger.filter { it["karigarId"] == karigarId }
        return mapOf("entries" to ledger)
    }
}
