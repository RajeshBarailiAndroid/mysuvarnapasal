package com.subarnapasal.common

import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/**
 * Shared POS calculation helpers, ported 1:1 from app/Support/Pos.php
 * (itself ported from the original Express backend). All money math is in
 * NPR and server-authoritative.
 */
object Pos {
    const val TOLA_GRAMS = 11.664
    const val AANA_PER_TOLA = 16.0
    const val LAAL_PER_AANA = 6.25
    const val LAAL_PER_TOLA = AANA_PER_TOLA * LAAL_PER_AANA

    val DEFAULT_FX_RATES: Doc get() = newDoc("USD" to 133.0, "CAD" to 98.0)
    val PAYMENT_METHODS = listOf("cash", "esewa", "khalti", "card", "bank", "credit")
    val DEFAULT_ITEM_CATEGORIES = listOf("Gold", "Silver", "Other")

    private val rng = SecureRandom()
    private val isoMillis = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
    private val isoDay = DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneOffset.UTC)

    /** JS `Number(x) || fallback` semantics. */
    fun num(v: Any?, fallback: Double = 0.0): Double = when (v) {
        null -> fallback
        is Boolean -> if (v) 1.0 else fallback
        is Number -> {
            val d = v.toDouble()
            if (d.isFinite()) (if (d == 0.0) 0.0 else d) else fallback
        }
        is String -> {
            val t = v.trim()
            if (t.isEmpty()) fallback else t.toDoubleOrNull()?.takeIf { it.isFinite() } ?: fallback
        }
        else -> fallback
    }

    /** Strict Number(x): null when not finite. */
    fun numOrNull(v: Any?): Double? = when (v) {
        null -> null
        is Boolean -> if (v) 1.0 else 0.0
        is Number -> v.toDouble().takeIf { it.isFinite() }
        is String -> {
            val t = v.trim()
            if (t.isEmpty()) null else t.toDoubleOrNull()?.takeIf { it.isFinite() }
        }
        else -> null
    }

    fun str(v: Any?): String = when (v) {
        null, is Map<*, *>, is List<*> -> ""
        is Boolean -> if (v) "true" else "false"
        else -> v.toString().trim()
    }

    fun newId(prefix: String): String {
        val bytes = ByteArray(4).also(rng::nextBytes)
        return prefix + "-" + bytes.joinToString("") { "%02x".format(it) }
    }

    fun nowIso(): String = isoMillis.format(Instant.now())

    fun today(): String = isoDay.format(Instant.now())

    fun round2(v: Double): Double = Math.round(v * 100.0) / 100.0

    fun gramsToTola(grams: Double): Double = Math.round(grams / TOLA_GRAMS * 1000.0) / 1000.0

    fun fxNprPerUnit(settings: Doc, code: Any?): Double {
        val c = str(code).ifEmpty { "USD" }.uppercase()
        if (c == "NPR") return 1.0
        val table: Doc = DEFAULT_FX_RATES
        settings["fxRates"].asDocOrNull()?.forEach { (k, v) -> table[k] = v }
        val v = numOrNull(table[c])
        return if (v != null && v > 0) v else 133.0
    }

    fun itemMetalType(item: Any?): String {
        val slug = str(item.asDocOrNull()?.get("category")).lowercase()
        return when (slug) {
            "silver" -> "silver"
            "other" -> "other"
            else -> "gold"
        }
    }

    fun resolveJartiWeightGrams(weightGrams: Double, jartiRateType: Any? = "percent", jartiRateValue: Any? = 0): Double {
        val value = num(jartiRateValue)
        if (value <= 0) return 0.0
        val type = str(jartiRateType)
        if (type == "grams") return value
        if (type == "percent") return if (weightGrams > 0) (weightGrams * value) / 100 else 0.0
        return 0.0
    }

    fun calcJartiAmount(opts: Doc): Double {
        val value = num(opts["jartiRateValue"])
        if (value <= 0) return 0.0
        val grams = num(opts["weightGrams"])
        val metal = num(opts["metalValue"])
        val ratePerTola = num(opts["ratePerTola"])
        val karatFactorRaw = num(opts["karatFactor"], 1.0)
        val karatFactor = if (karatFactorRaw == 0.0) 1.0 else karatFactorRaw
        val type = str(opts["jartiRateType"]).ifEmpty { "flat" }
        if (type == "percent" || type == "grams") {
            val jartiGrams = resolveJartiWeightGrams(grams, type, value)
            if (jartiGrams <= 0) return 0.0
            if (ratePerTola > 0) return jartiGrams * (ratePerTola / TOLA_GRAMS) * karatFactor
            if (type == "percent" && metal > 0) return (metal * value) / 100
            return 0.0
        }
        return when (type) {
            "per_gram" -> if (grams > 0) value * grams else 0.0
            "per_tola" -> if (grams > 0) value * (grams / TOLA_GRAMS) else 0.0
            else -> value // 'flat' and default
        }
    }

    /** rates: metals doc (goldRatePerTola / silverRatePerTola) or a bare gold rate number. */
    fun itemValue(item: Doc, rates: Any?): Long {
        val ratesDoc = rates.asDocOrNull()
        val goldRate = if (ratesDoc != null) num(ratesDoc["goldRatePerTola"]) else num(rates)
        val silverRate = if (ratesDoc != null) num(ratesDoc["silverRatePerTola"]) else 0.0
        val weightTola = gramsToTola(num(item["weightGrams"]))
        val making = num(item["makingCharge"])
        val metal = itemMetalType(item)
        var metalValue = 0.0
        var rate = 0.0
        var karatFactor = 1.0
        when (metal) {
            "silver" -> { rate = silverRate; metalValue = weightTola * silverRate }
            "other" -> {
                rate = num(item["customRatePerTola"])
                if (rate == 0.0) {
                    val sale = num(item["salePrice"])
                    if (sale > 0) return Math.round(sale)
                    return Math.round(making)
                }
                metalValue = weightTola * rate
            }
            else -> {
                rate = goldRate
                karatFactor = (num(item["karat"]).takeIf { it != 0.0 } ?: 24.0) / 24.0
                metalValue = weightTola * goldRate * karatFactor
            }
        }
        val jarti = calcJartiAmount(newDoc(
            "jartiRateType" to (item["jartiRateType"] ?: "flat"),
            "jartiRateValue" to (item["jartiRateValue"] ?: 0),
            "weightGrams" to num(item["weightGrams"]),
            "metalValue" to metalValue,
            "ratePerTola" to rate,
            "karatFactor" to karatFactor,
        ))
        return Math.round(metalValue + making + jarti)
    }

    fun isItemSoldOut(item: Any?): Boolean {
        val d = item.asDocOrNull() ?: return false
        return str(d["status"]) == "sold_out" || num(d["quantity"]) <= 0
    }

    fun normalizeItemRecord(item: Doc, isNew: Boolean = false): Doc {
        val qty = max(0L, floor(num(item["quantity"])).toLong())
        val status = str(item["status"]).ifEmpty { "in_stock" }
        if (status == "sold_out") { item["quantity"] = 0L; item["status"] = "sold_out"; return item }
        if (status == "in_stock" && qty == 0L) {
            if (isNew) { item["quantity"] = 1L; item["status"] = "in_stock" }
            else { item["quantity"] = 0L; item["status"] = "sold_out" }
            return item
        }
        if (qty > 0 && status == "sold_out") {
            if (isNew) { item["quantity"] = qty; item["status"] = "in_stock" }
            else { item["quantity"] = 0L; item["status"] = "sold_out" }
            return item
        }
        item["quantity"] = qty
        item["status"] = status
        return item
    }

    fun validateInventoryMetalFields(body: Doc): String? {
        val category = str(body["category"] ?: "gold").ifEmpty { "gold" }.lowercase()
        val metal = itemMetalType(newDoc("category" to category))
        if (metal == "other" && num(body["customRatePerTola"]) <= 0) {
            return "Enter a rate per tola for Other metal items."
        }
        return null
    }

    fun metalRateForItem(item: Doc, metals: Doc): Double = when (itemMetalType(item)) {
        "silver" -> num(metals["silverRatePerTola"])
        "other" -> num(item["customRatePerTola"])
        else -> num(metals["goldRatePerTola"])
    }

    fun metalDefaultName(category: String): String = when (itemMetalType(newDoc("category" to category))) {
        "silver" -> "Silver"
        "other" -> "Other"
        else -> "Gold"
    }

    fun calcItemLinePrice(item: Doc, opts: Doc): Long {
        val weightUnit = str(opts["weightUnit"] ?: "grams")
        val tolaParts = opts["tolaParts"].asDocOrNull()
        val metals = opts["metals"].asDoc()
        val metal = itemMetalType(item)
        val making = num(item["makingCharge"])
        val weightGrams = num(item["weightGrams"])
        var rate = metalRateForItem(item, metals)
        if (metal == "other" && rate == 0.0) {
            val sale = num(item["salePrice"])
            if (sale > 0) return Math.round(sale)
            return Math.round(making)
        }
        val karatFactor = if (metal == "gold") (num(item["karat"]).takeIf { it != 0.0 } ?: 24.0) / 24.0 else 1.0
        val metalValue: Double
        if (weightUnit == "tola" && tolaParts != null) {
            val t = num(tolaParts["tola"]); val a = num(tolaParts["aana"]); val l = num(tolaParts["laal"])
            if (t == 0.0 && a == 0.0 && l == 0.0) return 0
            if (rate == 0.0) return 0
            val rateAana = rate / AANA_PER_TOLA
            val rateLaal = rate / LAAL_PER_TOLA
            metalValue = (t * rate + a * rateAana + l * rateLaal) * karatFactor
        } else {
            if (weightGrams == 0.0) return 0
            return itemValue(item, metals)
        }
        val jarti = calcJartiAmount(newDoc(
            "jartiRateType" to (item["jartiRateType"] ?: "flat"),
            "jartiRateValue" to (item["jartiRateValue"] ?: 0),
            "weightGrams" to weightGrams,
            "metalValue" to metalValue,
            "ratePerTola" to rate,
            "karatFactor" to karatFactor,
        ))
        return Math.round(metalValue + making + jarti)
    }

    fun inDateRange(iso: Any?, start: String?, end: String?): Boolean {
        val day = str(iso).take(10)
        if (day.isEmpty()) return false
        if (start != null && day < start) return false
        if (end != null && day > end) return false
        return true
    }

    fun customerMatchKey(name: Any?, phone: Any?): String = str(name).lowercase() + "|" + str(phone)

    fun oldGoldBuyValue(weightGrams: Double, karat: Double, ratePerTola: Double): Long =
        Math.round((weightGrams / TOLA_GRAMS) * ratePerTola * ((karat.takeIf { it != 0.0 } ?: 24.0) / 24.0))

    fun schemePaidTotal(scheme: Doc): Double =
        scheme["installments"].asDocList().sumOf { num(it["amount"]) }

    fun saleDueRemaining(sale: Doc): Double {
        val baseDue = num(sale["payment"].asDocOrNull()?.get("due"))
        val paidSince = sale["payments"].asDocList().sumOf { num(it["amount"]) }
        return max(0.0, baseDue - paidSince)
    }

    fun withDueFields(sale: Doc): Doc {
        val out = deepCopy(sale).asDoc()
        val paidSince = out["payments"].asDocList().sumOf { num(it["amount"]) }
        out["paidSince"] = paidSince
        out["dueRemaining"] = saleDueRemaining(out)
        return out
    }

    // ── Phone validation ─────────────────────────────────────────────────

    val PHONE_REGIONS = listOf("NP", "US", "CA")

    fun phoneDigits(phone: Any?): String = (phone?.toString() ?: "").replace(Regex("\\D"), "")

    fun normalizePhoneRegion(region: Any?): String {
        val code = str(region).ifEmpty { "NP" }.uppercase()
        return if (code in PHONE_REGIONS) code else "NP"
    }

    fun isValidPhoneForRegion(phone: Any?, region: Any?): Boolean {
        val digits = phoneDigits(phone)
        if (digits.isEmpty()) return false
        return if (normalizePhoneRegion(region) == "NP") isNepaliPhone(digits) else isNanpPhone(digits)
    }

    fun isValidPhone(phone: Any?, region: Any? = null): Boolean {
        if (region != null) return isValidPhoneForRegion(phone, region)
        val digits = phoneDigits(phone)
        if (digits.isEmpty()) return false
        return isNepaliPhone(digits) || isNanpPhone(digits)
    }

    private fun isNepaliPhone(digits: String): Boolean {
        val national = digits.replaceFirst(Regex("^977"), "")
        return Regex("^(97|98)\\d{8}$").matches(national)
    }

    private fun isNanpPhone(digits: String): Boolean {
        val d = digits.replaceFirst(Regex("^1"), "")
        return d.length == 10 && Regex("^[2-9]\\d{2}[2-9]\\d{6}$").matches(d)
    }

    fun phoneErrorMessage(region: Any?): String = when (normalizePhoneRegion(region)) {
        "NP" -> "Enter a valid Nepal mobile number (97/98XXXXXXXX or +977…)."
        "US" -> "Enter a valid US phone number (10 digits)."
        "CA" -> "Enter a valid Canadian phone number (10 digits)."
        else -> "Enter a valid phone number."
    }

    fun validateCustomerPhone(phone: Any?, phoneRegion: Any?): String? {
        val p = str(phone)
        if (p.isEmpty()) return null
        if (phoneRegion != null && str(phoneRegion).isNotEmpty()) {
            return if (isValidPhoneForRegion(p, phoneRegion)) null else phoneErrorMessage(normalizePhoneRegion(phoneRegion))
        }
        return if (isValidPhone(p)) null else "Enter a valid phone number for Nepal, US, or Canada."
    }

    // ── Settings helpers ─────────────────────────────────────────────────

    fun defaultSettings(): Doc = newDoc(
        "shopName" to "SubarnaPasal", "shopAddress" to "", "shopPhone" to "", "shopPan" to "",
        "vatRate" to 13.0, "calendarMode" to "both", "priceMode" to "manual",
        "country" to null, "salesTaxRate" to 0.0,
        "goldRatePerTola" to 0.0, "goldRatePerGram" to 0.0, "goldBuyRatePerTola" to 0.0, "goldBuyRatePerGram" to 0.0,
        "silverRatePerTola" to 0.0, "silverRatePerGram" to 0.0, "currency" to "NPR",
        "locations" to mutableListOf<Any?>("Desk A", "Desk B", "Side Desk"),
        "itemCategories" to mutableListOf<Any?>("Gold", "Silver", "Other"),
        "rateHistory" to mutableListOf<Any?>(), "updatedAt" to nowIso(),
        "fxRates" to DEFAULT_FX_RATES, "fxUpdatedAt" to null,
        "invoiceCounter" to 0L, "repairCounter" to 0L, "schemeCounter" to 0L, "dueCounter" to 0L,
        "requestCounter" to 0L,
    )

    fun normalizeItemCategories(list: Any?): MutableList<Any?> {
        val items = mutableListOf<String>()
        (list as? List<*>)?.forEach { c ->
            val v = str(c)
            if (v.isNotEmpty() && v !in items) items.add(v)
        }
        for (name in listOf("Gold", "Silver", "Other")) {
            if (items.none { it.equals(name, ignoreCase = true) }) items.add(name)
        }
        return items.toMutableList<Any?>()
    }

    fun silverRatePerTolaFromSettings(settings: Doc): Double {
        val perTola = settings["silverRatePerTola"]
        if (perTola != null && num(perTola) > 0) return num(perTola)
        val perGram = num(settings["silverRatePerGram"])
        return if (perGram > 0) round2(perGram * TOLA_GRAMS) else 0.0
    }

    fun normalizeSilverRates(settings: Doc): Doc {
        val silverRatePerTola = silverRatePerTolaFromSettings(settings)
        settings["silverRatePerTola"] = silverRatePerTola
        settings["silverRatePerGram"] = round2(silverRatePerTola / TOLA_GRAMS)
        return settings
    }

    fun normalizeShopName(name: Any?): String = str(name).lowercase()

    /** Resolve metal rates: manual settings rates only (live pricing removed upstream). */
    fun resolveMetalRates(store: Doc): Doc {
        val settings = store["settings"].asDoc()
        val goldPerTola = num(settings["goldRatePerTola"])
        val perGramRaw = settings["goldRatePerGram"]
        val perGram = if (perGramRaw != null && str(perGramRaw).isNotEmpty()) perGramRaw else round2(goldPerTola / TOLA_GRAMS)
        return newDoc(
            "live" to false, "currency" to null,
            "goldRatePerTola" to (settings["goldRatePerTola"] ?: 0.0),
            "goldRatePerGram" to perGram,
            "silverRatePerTola" to (settings["silverRatePerTola"] ?: 0.0),
            "silverRatePerGram" to (settings["silverRatePerGram"] ?: 0.0),
            "fx" to newDoc("currency" to "NPR", "nprPerUnit" to 1, "updatedAt" to settings["fxUpdatedAt"]),
        )
    }
}
