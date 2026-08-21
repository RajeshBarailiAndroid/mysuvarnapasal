package com.subarnapasal.rates

import com.subarnapasal.common.ApiException
import com.subarnapasal.common.Doc
import com.subarnapasal.common.JSON
import com.subarnapasal.common.Pos
import com.subarnapasal.common.asDocOrNull
import com.subarnapasal.common.newDoc
import org.springframework.stereotype.Service
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.concurrent.ConcurrentHashMap

/**
 * Live gold/silver spot rates, ported from app/Services/MetalRates.php.
 * Providers: gold-api.com (default, free), goldapi.io, metals-api.
 * Results cached 5 minutes per currency.
 */
@Service
class MetalRatesService {
    companion object {
        const val TROY_OZ_GRAMS = 31.1034768
        const val CACHE_SECONDS = 5 * 60
        val METAL_CURRENCIES = listOf("USD", "CAD")

        fun normalizeMetalCurrency(currency: Any?): String {
            val code = Pos.str(currency).ifEmpty { "USD" }.uppercase()
            if (code == "NPR") return "USD"
            return if (code in METAL_CURRENCIES) code else "USD"
        }
    }

    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build()
    private val cache = ConcurrentHashMap<String, Pair<Long, Doc>>()

    fun provider(): String = (System.getenv("METAL_PRICE_PROVIDER") ?: "gold-api").lowercase()

    private fun apiKey(): String =
        (System.getenv("METAL_PRICE_API_KEY") ?: System.getenv("GOLD_API_KEY") ?: "").trim()

    fun hasValidApiKey(): Boolean {
        val key = apiKey()
        return key.isNotEmpty() && !key.contains("your-") && key != "your-api-key" && key != "your-goldapi-key"
    }

    private fun usesGoldApiCom(): Boolean = provider() in listOf("gold-api", "gold-api.com")

    fun isConfigured(): Boolean {
        if (usesGoldApiCom()) return true
        if (provider() in listOf("metals-api", "goldapi", "goldapi.io")) return hasValidApiKey()
        return true
    }

    private fun roundN(value: Any?, digits: Int): Double {
        val n = Pos.numOrNull(value) ?: return 0.0
        val f = Math.pow(10.0, digits.toDouble())
        return Math.round(n * f) / f
    }

    private fun buildMetalQuote(usdPerOz: Double): Doc {
        val perGram = usdPerOz / TROY_OZ_GRAMS
        val perTola = perGram * Pos.TOLA_GRAMS
        return newDoc("perOz" to roundN(usdPerOz, 2), "perGram" to roundN(perGram, 4), "perTola" to roundN(perTola, 2))
    }

    private fun goldApiTimestamp(value: Any?): String {
        if (value == null) return Pos.nowIso()
        val n = Pos.numOrNull(value)
        if (n != null) {
            val ms = if (n > 1e12) n else n * 1000
            return DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'.000Z'").withZone(ZoneOffset.UTC)
                .format(Instant.ofEpochMilli(ms.toLong()))
        }
        return value.toString()
    }

    private fun fetchJson(url: String, headers: Map<String, String> = emptyMap(), timeoutMs: Long = 15000): Doc {
        val builder = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofMillis(timeoutMs))
            .header("Accept", "application/json")
            .header("User-Agent", "SubarnaPasal/1.0")
        headers.forEach { (k, v) -> builder.header(k, v) }
        val response: HttpResponse<String> = try {
            http.send(builder.GET().build(), HttpResponse.BodyHandlers.ofString())
        } catch (e: java.net.http.HttpTimeoutException) {
            throw ApiException("Metal price API timed out. Try again in a moment.", 502)
        } catch (e: Exception) {
            throw ApiException("Metal price API request failed: ${e.message}", 502)
        }
        val data: Doc = try { JSON.readValue(response.body(), LinkedHashMap<String, Any?>().javaClass) } catch (e: Exception) { linkedMapOf() }
        if (response.statusCode() !in 200..299) {
            val message = data["error"] ?: data["message"] ?: data["detail"]
            throw ApiException(message?.toString() ?: "Metal API request failed (${response.statusCode()})", 502)
        }
        return data
    }

    private fun fetchFromGoldApiCom(currency: String): Doc {
        val code = normalizeMetalCurrency(currency)
        val gold = fetchJson("https://api.gold-api.com/price/XAU/$code")
        val silver = fetchJson("https://api.gold-api.com/price/XAG/$code")
        val goldOz = Pos.numOrNull(gold["price"]) ?: throw ApiException("gold-api.com returned invalid prices.", 502)
        val silverOz = Pos.numOrNull(silver["price"]) ?: throw ApiException("gold-api.com returned invalid prices.", 502)
        return newDoc(
            "currency" to (gold["currency"] ?: silver["currency"] ?: "USD"),
            "source" to "gold-api.com",
            "updatedAt" to (gold["updatedAt"] ?: silver["updatedAt"] ?: Pos.nowIso()),
            "gold" to buildMetalQuote(goldOz),
            "silver" to buildMetalQuote(silverOz),
        )
    }

    private fun buildMetalQuoteFromGoldApiIo(payload: Doc): Doc {
        val perOz = Pos.numOrNull(payload["price"])
        if (perOz == null || perOz <= 0) throw ApiException("GoldAPI.io returned invalid spot price.", 502)
        val perGram24k = Pos.numOrNull(payload["price_gram_24k"])
        val perGram = if (perGram24k != null && perGram24k > 0) perGram24k else perOz / TROY_OZ_GRAMS
        val quote = newDoc(
            "perOz" to roundN(perOz, 2), "perGram" to roundN(perGram, 4), "perTola" to roundN(perGram * Pos.TOLA_GRAMS, 2),
            "bid" to payload["bid"]?.let { roundN(it, 2) },
            "ask" to payload["ask"]?.let { roundN(it, 2) },
        )
        if (payload.containsKey("price_gram_22k")) {
            quote["karatPerGram"] = newDoc(
                "k24" to roundN(payload["price_gram_24k"] ?: 0, 4), "k22" to roundN(payload["price_gram_22k"], 4),
                "k21" to roundN(payload["price_gram_21k"] ?: 0, 4), "k20" to roundN(payload["price_gram_20k"] ?: 0, 4),
                "k18" to roundN(payload["price_gram_18k"] ?: 0, 4),
            )
        }
        return quote
    }

    private fun fetchFromGoldApiIo(): Doc {
        val headers = mapOf("x-access-token" to apiKey())
        val gold = fetchJson("https://www.goldapi.io/api/XAU/USD", headers)
        val silver = fetchJson("https://www.goldapi.io/api/XAG/USD", headers)
        return newDoc(
            "currency" to "USD", "source" to "goldapi.io",
            "exchange" to (gold["exchange"] ?: silver["exchange"]),
            "updatedAt" to goldApiTimestamp(gold["timestamp"] ?: silver["timestamp"]),
            "gold" to buildMetalQuoteFromGoldApiIo(gold),
            "silver" to buildMetalQuoteFromGoldApiIo(silver),
        )
    }

    private fun fetchFromMetalsApi(): Doc {
        val url = "https://metals-api.com/api/latest?access_key=${apiKey()}&base=USD&symbols=XAU,XAG"
        val data = fetchJson(url)
        val rates = data["rates"].asDocOrNull() ?: linkedMapOf()
        val goldRate = Pos.numOrNull(rates["XAU"])
        val silverRate = Pos.numOrNull(rates["XAG"])
        if (goldRate == null || silverRate == null || goldRate <= 0 || silverRate <= 0) {
            throw ApiException("Metals-API returned invalid prices.", 502)
        }
        val ts = Pos.numOrNull(data["timestamp"])
        return newDoc(
            "currency" to "USD", "source" to "metals-api",
            "updatedAt" to if (ts != null) DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'.000Z'")
                .withZone(ZoneOffset.UTC).format(Instant.ofEpochSecond(ts.toLong())) else Pos.nowIso(),
            "gold" to buildMetalQuote(1 / goldRate),
            "silver" to buildMetalQuote(1 / silverRate),
        )
    }

    fun getLiveRates(currency: Any? = "USD"): Doc {
        if (!isConfigured()) throw ApiException("Live metal API is not configured.", 503)
        val code = normalizeMetalCurrency(currency)
        val cached = cache["metal-rates:$code"]
        if (cached != null && cached.first > System.currentTimeMillis()) return cached.second
        val data = when {
            provider() == "metals-api" && hasValidApiKey() -> fetchFromMetalsApi()
            provider() in listOf("goldapi", "goldapi.io") && hasValidApiKey() -> fetchFromGoldApiIo()
            else -> fetchFromGoldApiCom(code)
        }
        cache["metal-rates:$code"] = (System.currentTimeMillis() + CACHE_SECONDS * 1000L) to data
        return data
    }
}
