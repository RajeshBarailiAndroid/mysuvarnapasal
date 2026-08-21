package com.subarnapasal.rates

import com.subarnapasal.common.ApiException
import com.subarnapasal.common.Doc
import com.subarnapasal.common.Pos
import com.subarnapasal.common.asDoc
import jakarta.servlet.http.HttpServletRequest
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

@RestController
class RatesController(private val metal: MetalRatesService, private val shared: SharedRatesService) {

    @GetMapping("/api/metal-rates")
    fun metalRates(@RequestParam(required = false) currency: String?): Any {
        if (!metal.isConfigured()) throw ApiException("Live metal API is not configured.", 503)
        val code = MetalRatesService.normalizeMetalCurrency(currency ?: "USD")
        val rates = try {
            metal.getLiveRates(code)
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            throw ApiException(e.message ?: "Could not fetch live metal rates.", 502)
        }
        val gold = (rates["gold"] as? Map<*, *>)
        val tolaNpr = shared.displayToNpr(gold?.get("perTola") ?: 0, code)
        val gramNpr = shared.displayToNpr(gold?.get("perGram") ?: 0, code).takeIf { it != 0.0 }
            ?: Pos.round2(tolaNpr / Pos.TOLA_GRAMS)
        if (tolaNpr > 0) {
            try {
                shared.appendHistory(linkedMapOf<String, Any?>(
                    "goldRatePerTola" to tolaNpr, "goldRatePerGram" to gramNpr,
                    "priceMode" to "api", "localDate" to shared.localDateStr(),
                ))
            } catch (e: Exception) { /* best-effort, matches Express behaviour */ }
        }
        return rates
    }

    @GetMapping("/api/shared/gold-rates")
    fun sharedGoldRates(
        @RequestParam(required = false) date: String?,
        @RequestParam(required = false) priceMode: String?,
    ): Any = shared.getForClient(
        (date ?: shared.localDateStr()).take(10),
        if (priceMode == "api") "api" else "manual",
    )

    @PostMapping("/api/shared/gold-rates/ticks")
    fun appendTicks(@RequestBody body: Doc): Any {
        val ticks = (body["ticks"] as? List<Any?>) ?: emptyList()
        val result = shared.appendTicks(ticks)
        return mapOf("ok" to true, "count" to result["count"])
    }

    @GetMapping("/api/cron/capture-gold-rate")
    fun cronCapture(request: HttpServletRequest, @RequestParam(required = false) currency: String?): Any {
        val secret = (System.getenv("CRON_SECRET") ?: "").trim()
        val auth = request.getHeader("Authorization") ?: ""
        val headerSecret = request.getHeader("x-cron-secret") ?: ""
        val authorized = secret.isNotEmpty() && (auth == "Bearer $secret" || headerSecret == secret)
        if (!authorized) throw ApiException("Cron secret required.", 401)
        return shared.captureIfChanged(currency)
    }

    // ── Internal endpoints for store-service (settings screen) ───────────

    @GetMapping("/internal/shared-rates")
    fun internalRead(): Any = shared.read()

    @PostMapping("/internal/shared-rates/history")
    fun internalAppendHistory(@RequestBody body: Doc): Any = shared.appendHistory(body)

    @DeleteMapping("/internal/shared-rates")
    fun internalClear(@RequestParam(required = false) priceMode: String?): Any =
        shared.clear(if (priceMode == "api") "api" else "manual")

    @PostMapping("/internal/shared-rates/write")
    fun internalWrite(@RequestBody body: Doc): Any {
        shared.write(body.asDoc())
        return mapOf("ok" to true, "kind" to "shared_rates")
    }
}
