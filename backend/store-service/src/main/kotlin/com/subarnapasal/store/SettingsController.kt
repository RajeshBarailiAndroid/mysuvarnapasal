package com.subarnapasal.store

import com.subarnapasal.common.ApiException
import com.subarnapasal.common.Doc
import com.subarnapasal.common.Pos
import com.subarnapasal.common.asDoc
import com.subarnapasal.common.newDoc
import com.subarnapasal.common.userId
import jakarta.servlet.http.HttpServletRequest
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
class SettingsController(private val repo: StoreRepository, private val rates: RatesClient) {

    @GetMapping("/api/settings")
    fun show(request: HttpServletRequest): Any {
        val store = repo.read(request.userId())
        val settings = Pos.normalizeSilverRates(store["settings"].asDoc())
        if (Pos.num(settings["goldRatePerTola"]) > 0 && Pos.str(settings["priceMode"] ?: "manual") != "api") {
            rates.appendHistory(newDoc(
                "goldRatePerTola" to settings["goldRatePerTola"],
                "goldRatePerGram" to settings["goldRatePerGram"],
                "priceMode" to "manual",
            ))
        }
        val shared = rates.read()
        val out = LinkedHashMap(settings)
        out["country"] = settings["country"]
        out["salesTaxRate"] = Pos.num(settings["salesTaxRate"])
        out["locations"] = StoreLogic.getStoreLocations(store)
        out["itemCategories"] = StoreLogic.getStoreItemCategories(store)
        out["goldRatePerGram"] = Pos.round2(Pos.num(settings["goldRatePerTola"]) / Pos.TOLA_GRAMS)
        out["goldBuyRatePerGram"] = Pos.round2(Pos.num(settings["goldBuyRatePerTola"]) / Pos.TOLA_GRAMS)
        out["rateHistory"] = shared["history"] ?: mutableListOf<Any?>()
        return out
    }

    @PatchMapping("/api/settings")
    fun update(request: HttpServletRequest, @RequestBody body: Doc): Any {
        val result = repo.update(request.userId()) { store ->
            val now = Pos.nowIso()
            val settings = store["settings"].asDoc()

            if (body.containsKey("goldRatePerTola") && body["goldRatePerTola"] != null) {
                val newRate = Pos.numOrNull(body["goldRatePerTola"])
                if (newRate == null || newRate < 0) throw ApiException("Gold rate must be a valid number.")
                settings["goldRatePerTola"] = newRate
                rates.appendHistory(newDoc(
                    "goldRatePerTola" to newRate,
                    "goldRatePerGram" to Pos.round2(newRate / Pos.TOLA_GRAMS),
                    "priceMode" to "manual",
                ))
            }
            if (body["goldBuyRatePerTola"] != null) {
                val buyRate = Pos.numOrNull(body["goldBuyRatePerTola"])
                if (buyRate == null || buyRate < 0) throw ApiException("Gold buy rate must be a valid number.")
                settings["goldBuyRatePerTola"] = buyRate
                settings["goldBuyRatePerGram"] = Pos.round2(buyRate / Pos.TOLA_GRAMS)
            } else if (body["goldBuyRatePerGram"] != null) {
                val perGram = Pos.num(body["goldBuyRatePerGram"])
                settings["goldBuyRatePerGram"] = perGram
                settings["goldBuyRatePerTola"] = Pos.round2(perGram * Pos.TOLA_GRAMS)
            }
            if (body["shopName"] != null) {
                val name = Pos.str(body["shopName"])
                if (name.isEmpty()) throw ApiException("Shop name is required.")
                if (Pos.normalizeShopName(name) != Pos.normalizeShopName(settings["shopName"])) {
                    if (repo.isShopNameTaken(name, request.userId())) {
                        throw ApiException("This store name is already taken. Please choose another name.", 409)
                    }
                }
                settings["shopName"] = name
            }
            if (body["shopAddress"] != null) settings["shopAddress"] = Pos.str(body["shopAddress"])
            if (body["shopPhone"] != null) settings["shopPhone"] = Pos.str(body["shopPhone"])
            if (body["shopPan"] != null) settings["shopPan"] = Pos.str(body["shopPan"])
            if (body["vatRate"] != null) {
                val rate = Pos.numOrNull(body["vatRate"])
                if (rate == null || rate < 0 || rate > 100) throw ApiException("VAT rate must be between 0 and 100.")
                settings["vatRate"] = rate
            }
            if (body["country"] != null) {
                val code = Pos.str(body["country"]).uppercase()
                if (code !in listOf("NP", "US", "CA")) throw ApiException("Shop location must be NP, US or CA.")
                settings["country"] = code
            }
            if (body["salesTaxRate"] != null) {
                val rate = Pos.numOrNull(body["salesTaxRate"])
                if (rate == null || rate < 0 || rate > 100) throw ApiException("Sales tax rate must be between 0 and 100.")
                settings["salesTaxRate"] = rate
            }
            if (body["calendarMode"] != null) {
                val mode = Pos.str(body["calendarMode"]).lowercase()
                if (mode in listOf("both", "bs", "ad")) settings["calendarMode"] = mode
            }
            // Live/API pricing is gone — the shop's own rate is the only rate.
            settings["priceMode"] = "manual"
            if (body["fxRates"] != null) {
                val fx = body["fxRates"] as? Map<*, *> ?: emptyMap<Any?, Any?>()
                val updated = Pos.DEFAULT_FX_RATES
                (settings["fxRates"] as? Map<*, *>)?.forEach { (k, v) -> updated[k.toString()] = v }
                for (code in listOf("USD", "CAD")) {
                    if (fx[code] != null) {
                        val v = Pos.numOrNull(fx[code])
                        if (v == null || v <= 0) throw ApiException("FX rate for $code must be a positive number (NPR per 1 $code).")
                        updated[code] = v
                    }
                }
                settings["fxRates"] = updated
                settings["fxUpdatedAt"] = now
            }
            if (body["silverRatePerTola"] != null) {
                settings["silverRatePerTola"] = Pos.num(body["silverRatePerTola"])
            } else if (body["silverRatePerGram"] != null) {
                val perGram = Pos.num(body["silverRatePerGram"])
                settings["silverRatePerGram"] = perGram
                settings["silverRatePerTola"] = Pos.round2(perGram * Pos.TOLA_GRAMS)
            }
            if (body["currency"] != null) {
                val code = Pos.str(body["currency"]).uppercase()
                if (code in listOf("USD", "CAD", "NPR")) settings["currency"] = code
            }
            if (body["locations"] != null) {
                val list = body["locations"] as? List<*> ?: throw ApiException("Locations must be an array.")
                val out = mutableListOf<Any?>()
                list.forEach { l ->
                    val v = Pos.str(l)
                    if (v.isNotEmpty() && v !in out) out.add(v)
                }
                settings["locations"] = out
            }
            if (body["itemCategories"] != null) {
                if (body["itemCategories"] !is List<*>) throw ApiException("Item categories must be an array.")
                settings["itemCategories"] = Pos.normalizeItemCategories(body["itemCategories"])
            }
            settings["updatedAt"] = now
            settings["goldRatePerGram"] = Pos.round2(Pos.num(settings["goldRatePerTola"]) / Pos.TOLA_GRAMS)
            settings["goldBuyRatePerGram"] = Pos.round2(Pos.num(settings["goldBuyRatePerTola"]) / Pos.TOLA_GRAMS)
            Pos.normalizeSilverRates(settings)

            val out = LinkedHashMap(settings)
            out["locations"] = StoreLogic.getStoreLocations(store)
            out["itemCategories"] = StoreLogic.getStoreItemCategories(store)
            out["goldBuyRatePerGram"] = Pos.round2(Pos.num(settings["goldBuyRatePerTola"]) / Pos.TOLA_GRAMS)
            out
        }
        val shared = rates.read()
        result["rateHistory"] = shared["history"] ?: mutableListOf<Any?>()
        return result
    }

    @PostMapping("/api/settings/daily-gold-rate")
    fun dailyGoldRate(@RequestBody body: Doc): Any {
        val tola = Pos.numOrNull(body["goldRatePerTola"])
        if (tola == null || tola < 0) throw ApiException("Gold rate must be a valid number.")
        val gram = Pos.num(body["goldRatePerGram"]).takeIf { it != 0.0 } ?: Pos.round2(tola / Pos.TOLA_GRAMS)
        val priceMode = if (body["priceMode"] == "api") "api" else "manual"
        val result = rates.appendHistory(newDoc(
            "goldRatePerTola" to tola, "goldRatePerGram" to gram,
            "priceMode" to priceMode, "localDate" to body["localDate"],
        ))
        val shared = rates.read()
        return mapOf("changed" to (result?.get("changed") ?: false), "rateHistory" to (shared["history"] ?: mutableListOf<Any?>()))
    }

    @DeleteMapping("/api/settings/rate-history")
    fun clearRateHistory(@RequestParam(required = false) priceMode: String?): Any {
        val result = rates.clear(if (priceMode == "api") "api" else "manual")
        return mapOf("rateHistory" to (result?.get("history") ?: mutableListOf<Any?>()))
    }

    @GetMapping("/api/settings/shop-name-available")
    fun shopNameAvailable(request: HttpServletRequest, @RequestParam(required = false) name: String?): Any {
        val n = Pos.str(name)
        if (n.isEmpty()) return mapOf("available" to false)
        return mapOf("available" to !repo.isShopNameTaken(n, request.userId()))
    }
}
