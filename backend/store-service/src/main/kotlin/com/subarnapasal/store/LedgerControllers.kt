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
class RepairController(private val repo: StoreRepository) {

    private val statuses = listOf("received", "in_progress", "ready", "delivered", "cancelled")

    @GetMapping("/api/repairs")
    fun index(request: HttpServletRequest, @RequestParam(required = false) status: String?): Any {
        val store = repo.read(request.userId())
        var repairs = store["repairs"].asDocList().toList()
        if (!status.isNullOrEmpty()) repairs = repairs.filter { Pos.str(it["status"]) == status }
        return mapOf("repairs" to repairs.sortedByDescending { it["createdAt"]?.toString() ?: "" })
    }

    @PostMapping("/api/repairs")
    fun create(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val repair = repo.update(request.userId()) { store ->
            val customerName = Pos.str(body["customerName"])
            val itemDescription = Pos.str(body["itemDescription"])
            if (customerName.isEmpty()) throw ApiException("Customer name is required.")
            if (itemDescription.isEmpty()) throw ApiException("Item description is required.")
            val now = Pos.nowIso()
            val repair = newDoc(
                "id" to Pos.newId("rep"), "repairNumber" to StoreLogic.nextRepairNumber(store), "status" to "received",
                "customerName" to customerName, "customerPhone" to Pos.str(body["customerPhone"]),
                "itemDescription" to itemDescription,
                "estimatedCharge" to max(0.0, Pos.num(body["estimatedCharge"])),
                "finalCharge" to null, "weightGrams" to Pos.num(body["weightGrams"]),
                "wastageGrams" to max(0.0, Pos.num(body["wastageGrams"])),
                "karigarId" to Pos.str(body["karigarId"]).ifEmpty { null },
                "karigarName" to Pos.str(body["karigarName"]),
                "promisedDate" to Pos.str(body["promisedDate"]),
                "notes" to Pos.str(body["notes"]),
                "deliveredAt" to null, "paymentMethod" to null,
                "createdAt" to now, "updatedAt" to now,
            )
            store.listAt("repairs").add(0, repair)
            StoreLogic.upsertCustomerInStore(store, newDoc("name" to customerName, "phone" to repair["customerPhone"]))
            repair
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(repair)
    }

    @PatchMapping("/api/repairs/{id}")
    fun update(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): Any =
        repo.update(request.userId()) { store ->
            val repair = store["repairs"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Repair not found.", 404)
            if (Pos.str(repair["status"]) == "delivered") throw ApiException("Delivered repairs cannot be changed.")
            val now = Pos.nowIso()
            if (body["status"] != null) {
                val nextStatus = body["status"].toString()
                if (nextStatus !in statuses) throw ApiException("Invalid repair status.")
                if (nextStatus == "delivered") {
                    val charge = if (body["finalCharge"] != null && body["finalCharge"] != "")
                        max(0.0, Pos.num(body["finalCharge"]))
                    else max(0.0, Pos.num(repair["estimatedCharge"]))
                    val method = if (body["paymentMethod"] in Pos.PAYMENT_METHODS) body["paymentMethod"].toString() else "cash"
                    repair["finalCharge"] = charge
                    repair["paymentMethod"] = method
                    repair["deliveredAt"] = now
                    if (charge > 0) {
                        store.listAt("transactions").add(0, newDoc(
                            "id" to Pos.newId("tx"), "type" to "sale", "itemId" to null,
                            "itemName" to "Repair ${repair["repairNumber"]} — ${repair["itemDescription"]}".take(120),
                            "quantity" to 1, "amount" to charge,
                            "note" to "Repair ${repair["repairNumber"]} — ${repair["customerName"]} · $method",
                            "createdAt" to now,
                        ))
                    }
                }
                repair["status"] = nextStatus
            }
            if (body["customerName"] != null) repair["customerName"] = Pos.str(body["customerName"]).ifEmpty { Pos.str(repair["customerName"]) }
            if (body["customerPhone"] != null) repair["customerPhone"] = Pos.str(body["customerPhone"])
            if (body["itemDescription"] != null) repair["itemDescription"] = Pos.str(body["itemDescription"]).ifEmpty { Pos.str(repair["itemDescription"]) }
            if (body["estimatedCharge"] != null) repair["estimatedCharge"] = max(0.0, Pos.num(body["estimatedCharge"]))
            if (body["weightGrams"] != null) repair["weightGrams"] = Pos.num(body["weightGrams"])
            if (body["wastageGrams"] != null) repair["wastageGrams"] = max(0.0, Pos.num(body["wastageGrams"]))
            if (body.containsKey("karigarId")) repair["karigarId"] = Pos.str(body["karigarId"]).ifEmpty { null }
            if (body["karigarName"] != null) repair["karigarName"] = Pos.str(body["karigarName"])
            if (body["promisedDate"] != null) repair["promisedDate"] = Pos.str(body["promisedDate"])
            if (body["notes"] != null) repair["notes"] = Pos.str(body["notes"])
            repair["updatedAt"] = now
            repair
        }

    @DeleteMapping("/api/repairs/{id}")
    fun destroy(request: HttpServletRequest, @PathVariable id: String): Any =
        repo.update(request.userId()) { store ->
            val repair = store["repairs"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Repair not found.", 404)
            if (Pos.str(repair["status"]) != "cancelled") throw ApiException("Only cancelled repairs can be deleted. Cancel it first.")
            store.listAt("repairs").removeAll { it.asDocOrNull()?.get("id") == id }
            mapOf("ok" to true)
        }
}

@RestController
class SchemeController(private val repo: StoreRepository) {

    @GetMapping("/api/schemes")
    fun index(request: HttpServletRequest, @RequestParam(required = false) status: String?): Any {
        val store = repo.read(request.userId())
        var schemes = store["schemes"].asDocList().toList()
        if (!status.isNullOrEmpty()) schemes = schemes.filter { Pos.str(it["status"]) == status }
        schemes = schemes.sortedByDescending { it["createdAt"]?.toString() ?: "" }
        return mapOf("schemes" to schemes.map { s ->
            LinkedHashMap(s).also { it["paidTotal"] = Pos.schemePaidTotal(s) }
        })
    }

    @PostMapping("/api/schemes")
    fun create(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val scheme = repo.update(request.userId()) { store ->
            val customerName = Pos.str(body["customerName"])
            val monthlyAmount = max(0.0, Pos.num(body["monthlyAmount"]))
            val durationMonths = max(1L, Math.floor(Pos.num(body["durationMonths"]).takeIf { it != 0.0 } ?: 12.0).toLong())
            if (customerName.isEmpty()) throw ApiException("Customer name is required.")
            if (monthlyAmount <= 0) throw ApiException("Monthly amount must be greater than 0.")
            val now = Pos.nowIso()
            val scheme = newDoc(
                "id" to Pos.newId("gs"), "schemeNumber" to StoreLogic.nextSchemeNumber(store), "status" to "active",
                "customerName" to customerName, "customerPhone" to Pos.str(body["customerPhone"]),
                "monthlyAmount" to monthlyAmount, "durationMonths" to durationMonths,
                "startDate" to Pos.str(body["startDate"]).ifEmpty { now.take(10) },
                "installments" to mutableListOf<Any?>(),
                "notes" to Pos.str(body["notes"]),
                "createdAt" to now, "updatedAt" to now,
            )
            store.listAt("schemes").add(0, scheme)
            StoreLogic.upsertCustomerInStore(store, newDoc("name" to customerName, "phone" to scheme["customerPhone"]))
            LinkedHashMap(scheme).also { it["paidTotal"] = 0.0 }
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(scheme)
    }

    @PostMapping("/api/schemes/{id}/installments")
    fun addInstallment(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): ResponseEntity<Any> {
        val result = repo.update(request.userId()) { store ->
            val scheme = store["schemes"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Scheme not found.", 404)
            if (Pos.str(scheme["status"]) != "active") {
                throw ApiException("Scheme is ${scheme["status"]}; deposits are only allowed while active.")
            }
            val amount = max(0.0, Pos.num(body["amount"]))
            if (amount <= 0) throw ApiException("Deposit amount must be greater than 0.")
            val now = Pos.nowIso()
            val installment = newDoc(
                "id" to Pos.newId("ins"), "amount" to amount,
                "date" to Pos.str(body["date"]).ifEmpty { now.take(10) },
                "method" to if (body["method"] in Pos.PAYMENT_METHODS) body["method"].toString() else "cash",
                "note" to Pos.str(body["note"]), "createdAt" to now,
            )
            scheme.listAt("installments").add(installment)
            val paidTotal = Pos.schemePaidTotal(scheme)
            if (scheme["installments"].asDocList().size >= Pos.num(scheme["durationMonths"]).toInt()
                || paidTotal >= Pos.num(scheme["monthlyAmount"]) * Pos.num(scheme["durationMonths"])
            ) {
                scheme["status"] = "matured"
            }
            scheme["updatedAt"] = now
            newDoc(
                "installment" to installment,
                "scheme" to LinkedHashMap(scheme).also { it["paidTotal"] = paidTotal },
            )
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(result)
    }

    @PatchMapping("/api/schemes/{id}")
    fun update(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): Any =
        repo.update(request.userId()) { store ->
            val scheme = store["schemes"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Scheme not found.", 404)
            if (Pos.str(scheme["status"]) == "redeemed") {
                throw ApiException("Redeemed schemes cannot be changed. Void the linked sale to reactivate.")
            }
            if (body["status"] != null) {
                val status = body["status"].toString()
                if (status !in listOf("active", "matured", "cancelled")) throw ApiException("Invalid scheme status.")
                scheme["status"] = status
            }
            if (body["notes"] != null) scheme["notes"] = Pos.str(body["notes"])
            if (body["customerPhone"] != null) scheme["customerPhone"] = Pos.str(body["customerPhone"])
            scheme["updatedAt"] = Pos.nowIso()
            LinkedHashMap(scheme).also { it["paidTotal"] = Pos.schemePaidTotal(scheme) }
        }
}

/** Options (Taken / Given / Kept) ledger. */
@RestController
class OptionController(private val repo: StoreRepository) {

    private val types = listOf("taken", "given", "kept", "credit", "borrow", "deposit")
    private val metals = listOf("cash", "gold", "silver", "other")

    @GetMapping("/api/options")
    fun index(request: HttpServletRequest): Any = repo.read(request.userId())["options"].asDocList()

    @PostMapping("/api/options")
    fun create(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val option = repo.update(request.userId()) { store ->
            val name = Pos.str(body["name"])
            if (name.isEmpty()) throw ApiException("Name is required.")
            val type = if (body["type"] in types) body["type"].toString() else "credit"
            val now = Pos.nowIso()
            val metal = if (body["metal"] in metals) body["metal"].toString()
            else if (Pos.num(body["weightGrams"]) > 0) "gold" else "cash"
            val option = newDoc(
                "id" to Pos.newId("opt"), "type" to type, "metal" to metal, "name" to name,
                "item" to Pos.str(body["item"]),
                "weightGrams" to Pos.num(body["weightGrams"]),
                "karat" to (Pos.num(body["karat"]).takeIf { it != 0.0 } ?: 22.0),
                "rate" to Pos.num(body["rate"]),
                "cost" to Pos.num(body["cost"]),
                "date" to Pos.str(body["date"]).ifEmpty { now.take(10) },
                "committedDate" to (body["committedDate"]?.toString() ?: ""),
                "notes" to Pos.str(body["notes"]),
                "payments" to mutableListOf<Any?>(),
                "status" to "open",
                "createdAt" to now, "updatedAt" to now,
            )
            store.listAt("options").add(0, option)
            option
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(option)
    }

    @PutMapping("/api/options/{id}")
    fun update(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): Any =
        repo.update(request.userId()) { store ->
            val opt = store["options"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Option not found.", 404)
            if (body["name"] != null) opt["name"] = Pos.str(body["name"])
            if (body["item"] != null) opt["item"] = Pos.str(body["item"])
            if (body["type"] != null && body["type"] in types) opt["type"] = body["type"]
            if (body["metal"] != null && body["metal"] in metals) opt["metal"] = body["metal"]
            if (body["weightGrams"] != null) opt["weightGrams"] = Pos.num(body["weightGrams"])
            if (body["karat"] != null) opt["karat"] = Pos.num(body["karat"]).takeIf { it != 0.0 } ?: 22.0
            if (body["rate"] != null) opt["rate"] = Pos.num(body["rate"])
            if (body["cost"] != null) opt["cost"] = Pos.num(body["cost"])
            if (body["date"] != null) opt["date"] = body["date"].toString()
            if (body["committedDate"] != null) opt["committedDate"] = body["committedDate"].toString()
            if (body["notes"] != null) opt["notes"] = Pos.str(body["notes"])
            if (body["status"] != null && body["status"] in listOf("open", "closed")) opt["status"] = body["status"]
            opt["updatedAt"] = Pos.nowIso()
            opt
        }

    @DeleteMapping("/api/options/{id}")
    fun destroy(request: HttpServletRequest, @PathVariable id: String): Any =
        repo.update(request.userId()) { store ->
            val options = store.listAt("options")
            val before = options.size
            options.removeAll { it.asDocOrNull()?.get("id") == id }
            if (options.size == before) throw ApiException("Option not found.", 404)
            mapOf("ok" to true)
        }

    @PostMapping("/api/options/{id}/payments")
    fun addPayment(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): ResponseEntity<Any> {
        val result = repo.update(request.userId()) { store ->
            val opt = store["options"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Option not found.", 404)
            if (Pos.str(opt["saleId"]).isNotEmpty()) {
                throw ApiException("This record is linked to an invoice — receive payments in Reports → Invoices.")
            }
            val amount = Pos.num(body["amount"])
            if (amount <= 0) throw ApiException("Payment amount must be greater than 0.")
            val now = Pos.nowIso()
            val payment = newDoc(
                "id" to Pos.newId("pay"), "amount" to amount,
                "date" to Pos.str(body["date"]).ifEmpty { now.take(10) },
                "note" to Pos.str(body["note"]),
                "createdAt" to now,
            )
            opt.listAt("payments").add(payment)
            opt["updatedAt"] = now
            newDoc("payment" to payment, "option" to opt)
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(result)
    }

    @PutMapping("/api/options/{id}/payments/{paymentId}")
    fun updatePayment(
        request: HttpServletRequest,
        @PathVariable id: String,
        @PathVariable paymentId: String,
        @RequestBody body: Doc,
    ): Any = repo.update(request.userId()) { store ->
        val opt = store["options"].asDocList().firstOrNull { it["id"] == id }
            ?: throw ApiException("Option not found.", 404)
        if (Pos.str(opt["saleId"]).isNotEmpty()) {
            throw ApiException("This record is linked to an invoice — its payments cannot be edited here.")
        }
        val payment = opt["payments"].asDocList().firstOrNull { it["id"] == paymentId }
            ?: throw ApiException("Payment not found.", 404)
        if (body["amount"] != null) {
            val amount = Pos.num(body["amount"])
            if (amount <= 0) throw ApiException("Payment amount must be greater than 0.")
            payment["amount"] = amount
        }
        if (body["date"] != null) payment["date"] = body["date"].toString().take(10)
        if (body["note"] != null) payment["note"] = Pos.str(body["note"])
        val now = Pos.nowIso()
        payment["updatedAt"] = now
        opt["updatedAt"] = now
        newDoc("payment" to payment, "option" to opt)
    }

    @DeleteMapping("/api/options/{id}/payments/{paymentId}")
    fun deletePayment(request: HttpServletRequest, @PathVariable id: String, @PathVariable paymentId: String): Any =
        repo.update(request.userId()) { store ->
            val opt = store["options"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Option not found.", 404)
            if (Pos.str(opt["saleId"]).isNotEmpty()) {
                throw ApiException("This record is linked to an invoice — its payments cannot be removed here.")
            }
            val payments = opt.listAt("payments")
            val before = payments.size
            payments.removeAll { it.asDocOrNull()?.get("id") == paymentId }
            if (payments.size == before) throw ApiException("Payment not found.", 404)
            opt["updatedAt"] = Pos.nowIso()
            mapOf("ok" to true)
        }
}

/** Customer item requests ("requested items") — the shop-facing endpoints. */
@RestController
class RequestController(private val repo: StoreRepository) {

    companion object {
        val STATUSES = listOf("open", "fulfilled", "cancelled")

        fun itemFromInput(raw: Any?): Doc? {
            val r = raw.asDocOrNull() ?: return null
            val name = Pos.str(r["name"])
            if (name.isEmpty()) return null
            return newDoc(
                "id" to Pos.str(r["id"]).ifEmpty { Pos.newId("ri") },
                "itemId" to Pos.str(r["itemId"]).ifEmpty { null },
                "itemCode" to Pos.str(r["itemCode"]).take(60),
                "unit" to Pos.str(r["unit"]).take(40),
                "name" to name.take(200),
                "category" to Pos.str(r["category"]),
                "karat" to Pos.num(r["karat"]),
                "weightGrams" to max(0.0, Pos.num(r["weightGrams"])),
                "quantity" to max(1L, Pos.num(r["quantity"] ?: 1).toLong()),
                "price" to max(0.0, Pos.num(r["price"])),
                "note" to Pos.str(r["note"]).take(300),
            )
        }

        fun itemsFromInput(raw: Any?): MutableList<Doc> {
            val out = mutableListOf<Doc>()
            (raw as? List<*>)?.forEach { row -> itemFromInput(row)?.let(out::add) }
            return out
        }
    }

    @GetMapping("/api/requests")
    fun index(request: HttpServletRequest, @RequestParam(required = false) status: String?): Any {
        val store = repo.read(request.userId())
        var requests = store["requests"].asDocList().toList()
        if (!status.isNullOrEmpty()) requests = requests.filter { Pos.str(it["status"]) == status }
        requests = requests.sortedByDescending { it["createdAt"]?.toString() ?: "" }
        return newDoc(
            "requests" to requests,
            "openCount" to store["requests"].asDocList().count { Pos.str(it["status"]) == "open" },
        )
    }

    @PostMapping("/api/requests")
    fun create(request: HttpServletRequest, @RequestBody body: Doc): ResponseEntity<Any> {
        val entry = repo.update(request.userId()) { store ->
            val customerName = Pos.str(body["customerName"])
            if (customerName.isEmpty()) throw ApiException("Customer name is required.")
            val items = itemsFromInput(body["items"])
            if (items.isEmpty()) throw ApiException("Add at least one requested item.")
            val now = Pos.nowIso()
            val entry = newDoc(
                "id" to Pos.newId("req"),
                "requestNumber" to StoreLogic.nextRequestNumber(store),
                "status" to "open",
                "customerName" to customerName.take(120),
                "customerPhone" to Pos.str(body["customerPhone"]),
                "items" to items,
                "note" to Pos.str(body["note"]).take(500),
                "fulfilledAt" to null,
                "createdAt" to now, "updatedAt" to now,
            )
            store.listAt("requests").add(0, entry)
            StoreLogic.upsertCustomerInStore(store, newDoc("name" to entry["customerName"], "phone" to entry["customerPhone"]))
            entry
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(entry)
    }

    @PatchMapping("/api/requests/{id}")
    fun update(request: HttpServletRequest, @PathVariable id: String, @RequestBody body: Doc): Any =
        repo.update(request.userId()) { store ->
            val entry = store["requests"].asDocList().firstOrNull { it["id"] == id }
                ?: throw ApiException("Request not found.", 404)
            val now = Pos.nowIso()
            if (body["status"] != null) {
                val next = body["status"].toString()
                if (next !in STATUSES) throw ApiException("Invalid request status.")
                entry["fulfilledAt"] = if (next == "fulfilled") now else null
                entry["status"] = next
            }
            if (body["customerName"] != null) {
                entry["customerName"] = Pos.str(body["customerName"]).take(120).ifEmpty { Pos.str(entry["customerName"]) }
            }
            if (body["customerPhone"] != null) entry["customerPhone"] = Pos.str(body["customerPhone"])
            if (body.containsKey("items")) {
                val items = itemsFromInput(body["items"])
                if (items.isEmpty()) throw ApiException("Add at least one requested item.")
                entry["items"] = items
            }
            if (body["note"] != null) entry["note"] = Pos.str(body["note"]).take(500)
            entry["updatedAt"] = now
            entry
        }

    @DeleteMapping("/api/requests/{id}")
    fun destroy(request: HttpServletRequest, @PathVariable id: String): Any =
        repo.update(request.userId()) { store ->
            val requests = store.listAt("requests")
            val before = requests.size
            requests.removeAll { it.asDocOrNull()?.get("id") == id }
            if (requests.size == before) throw ApiException("Request not found.", 404)
            mapOf("ok" to true)
        }
}
