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
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.max
import kotlin.math.min

/**
 * Public customer request link (no login). One unguessable per-shop code
 * (HMAC of the user id) unlocks exactly three things: read-only in-stock
 * inventory, the caller's own requests, and filing a new request.
 * Ported from the Laravel PublicRequestController.
 */
@RestController
class PublicRequestController(private val repo: StoreRepository, private val jdbc: JdbcTemplate) {

    companion object {
        val PUBLIC_ITEM_FIELDS = listOf(
            "id", "itemNumber", "sku", "name", "category", "karat", "weightGrams",
            "weightUnit", "makingCharge", "jartiRateType", "jartiRateValue",
            "salePrice", "customRatePerTola", "stoneAmount", "quantity", "status", "hallmark",
        )
        const val MAX_ITEMS_PER_REQUEST = 25

        fun codeFor(userId: String): String {
            val salt = System.getenv("PUBLIC_REQUEST_SALT")?.takeIf { it.isNotEmpty() }
                ?: System.getenv("JWT_SECRET") ?: "subarnapasal-dev-secret-change-me-in-production-0123456789"
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(salt.toByteArray(), "HmacSHA256"))
            val digest = mac.doFinal("subarnapasal-public-request:$userId".toByteArray())
            return digest.joinToString("") { "%02x".format(it) }.take(20)
        }
    }

    private fun resolveUserId(code: String): String? {
        val clean = code.lowercase().replace(Regex("[^0-9a-f]"), "")
        if (clean.isEmpty()) return null
        val candidates = mutableListOf("local-dev")
        candidates.addAll(repo.allUserIds())
        for (userId in candidates.distinct()) {
            if (MessageDigest.isEqual(codeFor(userId).toByteArray(), clean.toByteArray())) return userId
        }
        return null
    }

    private fun publicItem(item: Doc): Doc {
        val out: Doc = linkedMapOf()
        PUBLIC_ITEM_FIELDS.forEach { field -> if (item.containsKey(field)) out[field] = item[field] }
        return out
    }

    private fun unitLabel(item: Doc): String {
        val grams = Pos.num(item["weightGrams"])
        val weightUnit = Pos.str(item["weightUnit"]).lowercase()
        fun fmt(v: Double): String = "%.3f".format(v).trimEnd('0').trimEnd('.')
        if (grams > 0 && weightUnit == "tola") return "piece (${fmt(grams / Pos.TOLA_GRAMS)} tola each)"
        if (grams > 0) return "piece (${fmt(grams)} g each)"
        return "piece"
    }

    private fun isAvailable(item: Doc): Boolean {
        val status = Pos.str(item["status"]).lowercase()
        return Pos.num(item["quantity"]) > 0 && status != "sold" && status != "sold_out"
    }

    /** Read-only inventory for the shared link. */
    @GetMapping("/api/public/{code}/items")
    fun items(@PathVariable code: String): Any {
        val userId = resolveUserId(code) ?: throw ApiException("This link is not valid.", 404)
        val store = repo.read(userId)
        val items = store["items"].asDocList()
            .filter { isAvailable(it) }
            .map { publicItem(it) }
            .sortedBy { Pos.str(it["name"]) }
        val metals = Pos.resolveMetalRates(store)
        val settings = store["settings"].asDoc()
        return newDoc(
            "shopName" to Pos.str(settings["shopName"]).ifEmpty { "SubarnaPasal" },
            "shopPhone" to Pos.str(settings["shopPhone"]),
            "currency" to Pos.str(settings["currency"]).ifEmpty { "NPR" },
            "items" to items,
            "goldRatePerTola" to metals["goldRatePerTola"],
            "silverRatePerTola" to metals["silverRatePerTola"],
            "metalRatesLive" to metals["live"],
            "metalCurrency" to metals["currency"],
        )
    }

    /** The caller's own requests — name AND phone must both match. */
    @GetMapping("/api/public/{code}/requests")
    fun mine(
        @PathVariable code: String,
        @RequestParam(required = false) name: String?,
        @RequestParam(required = false) phone: String?,
    ): Any {
        val userId = resolveUserId(code) ?: throw ApiException("This link is not valid.", 404)
        val n = Pos.str(name).lowercase()
        val p = Pos.str(phone).replace(Regex("\\D"), "")
        if (n.isEmpty() || p.isEmpty()) return mapOf("requests" to emptyList<Any?>())
        val mine = repo.read(userId)["requests"].asDocList().filter { entry ->
            Pos.str(entry["customerName"]).lowercase() == n &&
                Pos.str(entry["customerPhone"]).replace(Regex("\\D"), "") == p
        }.sortedByDescending { it["createdAt"]?.toString() ?: "" }
        return mapOf("requests" to mine)
    }

    /** File a request. Same stored shape as the shop's own POST /api/requests. */
    @PostMapping("/api/public/{code}/requests")
    fun create(@PathVariable code: String, @RequestBody body: Doc): ResponseEntity<Any> {
        val userId = resolveUserId(code) ?: throw ApiException("This link is not valid.", 404)
        val entry = repo.update(userId) { store ->
            val customerName = Pos.str(body["customerName"])
            if (customerName.isEmpty()) throw ApiException("Your name is required.")
            val customerPhone = Pos.str(body["customerPhone"])
            if (customerPhone.replace(Regex("\\D"), "").isEmpty()) throw ApiException("Your phone number is required.")

            val rawItems = (body["items"] as? List<*>) ?: emptyList<Any?>()
            if (rawItems.size > MAX_ITEMS_PER_REQUEST) {
                throw ApiException("Too many items in one request. Please send at most $MAX_ITEMS_PER_REQUEST.")
            }

            // Requests are matched against real inventory; body values are never trusted.
            val byId = store["items"].asDocList().filter { Pos.str(it["id"]).isNotEmpty() }
                .associateBy { it["id"].toString() }

            val items = mutableListOf<Doc>()
            rawItems.forEach { rawAny ->
                val raw = rawAny.asDocOrNull() ?: return@forEach
                val itemId = Pos.str(raw["itemId"])
                val item = byId[itemId] ?: return@forEach
                if (!isAvailable(item)) return@forEach
                val available = Pos.num(item["quantity"]).toLong()
                val quantity = max(1L, Pos.num(raw["quantity"] ?: 1).toLong())
                items.add(newDoc(
                    "id" to Pos.newId("ri"),
                    "itemId" to itemId,
                    "itemCode" to Pos.str(item["itemNumber"]).ifEmpty { Pos.str(item["sku"]) }.take(60),
                    "name" to Pos.str(item["name"]).take(200),
                    "category" to Pos.str(item["category"]),
                    "unit" to unitLabel(item),
                    "karat" to Pos.num(item["karat"]),
                    "weightGrams" to max(0.0, Pos.num(item["weightGrams"])),
                    "quantity" to min(available, quantity),
                    "price" to max(0.0, Pos.num(item["salePrice"])),
                    "note" to "",
                ))
            }
            if (items.isEmpty()) throw ApiException("Pick at least one item that is still in stock.")

            val now = Pos.nowIso()
            val entry = newDoc(
                "id" to Pos.newId("req"),
                "requestNumber" to StoreLogic.nextRequestNumber(store),
                "status" to "open",
                "customerName" to customerName.take(120),
                "customerPhone" to customerPhone.take(40),
                "items" to items,
                "note" to Pos.str(body["note"]).take(500),
                "source" to "link",
                "fulfilledAt" to null,
                "createdAt" to now, "updatedAt" to now,
            )
            store.listAt("requests").add(0, entry)
            StoreLogic.upsertCustomerInStore(store, newDoc(
                "name" to entry["customerName"], "phone" to entry["customerPhone"],
            ))
            entry
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(entry)
    }

    /** Signed-in shop owner: "what link do I share with customers?" */
    @GetMapping("/api/public-link")
    fun link(request: HttpServletRequest): Any {
        val userId = request.userId()
        val code = codeFor(userId)
        val base = (System.getenv("APP_URL") ?: "http://localhost:8080").trimEnd('/')
        return newDoc(
            "code" to code,
            "url" to "$base/order/$code",
            "pageUrl" to "$base/customer.html?shop=$code",
        )
    }
}
