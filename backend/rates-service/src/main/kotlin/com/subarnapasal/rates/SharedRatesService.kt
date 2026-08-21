package com.subarnapasal.rates

import com.subarnapasal.common.Doc
import com.subarnapasal.common.JSON
import com.subarnapasal.common.Pos
import com.subarnapasal.common.asDocList
import com.subarnapasal.common.newDoc
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Global (cross-shop) gold price ticks + daily history, ported from
 * app/Services/SharedRates.php. Stored as JSONB in shared_gold_rates.
 */
@Service
class SharedRatesService(private val jdbc: JdbcTemplate, private val metal: MetalRatesService) {
    companion object {
        const val GLOBAL_ID = "global"
        const val MAX_HISTORY_PER_MODE = 500
        const val MAX_TICKS = 90000
    }

    fun nprPerUnit(code: String): Double {
        val usd = Pos.num(System.getenv("FX_NPR_PER_USD")).takeIf { it > 0 } ?: 133.0
        val cad = Pos.num(System.getenv("FX_NPR_PER_CAD")).takeIf { it > 0 } ?: 98.0
        return when (code) { "USD" -> usd; "CAD" -> cad; "NPR" -> 1.0; else -> usd }
    }

    fun displayToNpr(amount: Any?, currency: Any?): Double {
        val requested = Pos.str(currency).ifEmpty { "USD" }.uppercase()
        val apiCode = MetalRatesService.normalizeMetalCurrency(requested)
        val factor = if (requested == "NPR") nprPerUnit("USD") else nprPerUnit(apiCode)
        return Pos.num(amount) * factor
    }

    fun localDateStr(): String = LocalDate.now().toString()

    private fun daySecondFromUpdatedAt(updatedAt: String): Long = try {
        val t = OffsetDateTime.parse(updatedAt).atZoneSameInstant(ZoneOffset.systemDefault())
        (t.hour * 3600 + t.minute * 60 + t.second).toLong()
    } catch (e: Exception) {
        try {
            val t = LocalDateTime.parse(updatedAt.take(19), DateTimeFormatter.ISO_LOCAL_DATE_TIME)
            (t.hour * 3600 + t.minute * 60 + t.second).toLong()
        } catch (e2: Exception) { 0L }
    }

    fun normalizeTick(entry: Doc): Doc {
        val updatedAt = entry["updatedAt"]?.toString() ?: Pos.nowIso()
        val goldRatePerTola = Pos.num(entry["goldRatePerTola"])
        return newDoc(
            "date" to Pos.str(entry["date"]).ifEmpty { updatedAt.take(10) }.take(10),
            "updatedAt" to updatedAt,
            "daySecond" to if (entry["daySecond"] != null)
                Math.max(0L, Math.min(86399L, Math.floor(Pos.num(entry["daySecond"])).toLong()))
            else daySecondFromUpdatedAt(updatedAt),
            "secondNum" to Math.max(1L, Math.floor(Pos.num(entry["secondNum"], 1.0).takeIf { it != 0.0 } ?: 1.0).toLong()),
            "goldRatePerTola" to goldRatePerTola,
            "goldRatePerGram" to (Pos.num(entry["goldRatePerGram"]).takeIf { it != 0.0 } ?: Pos.round2(goldRatePerTola / Pos.TOLA_GRAMS)),
            "priceMode" to if (Pos.str(entry["priceMode"]) == "api") "api" else "manual",
            "saved" to (entry["saved"] == true),
        )
    }

    fun normalizeHistoryEntry(entry: Doc): Doc {
        val updatedAt = entry["updatedAt"]?.toString() ?: Pos.nowIso()
        val goldRatePerTola = Pos.num(entry["goldRatePerTola"])
        return newDoc(
            "date" to Pos.str(entry["date"]).ifEmpty { updatedAt.take(10) }.take(10),
            "updatedAt" to updatedAt,
            "goldRatePerTola" to goldRatePerTola,
            "goldRatePerGram" to (Pos.num(entry["goldRatePerGram"]).takeIf { it != 0.0 } ?: Pos.round2(goldRatePerTola / Pos.TOLA_GRAMS)),
            "priceMode" to if (Pos.str(entry["priceMode"]) == "api") "api" else "manual",
        )
    }

    private fun trimHistory(history: List<Doc>): MutableList<Doc> {
        val manual = history.filter { Pos.str(it["priceMode"]) != "api" }.sortedByDescending { it["updatedAt"].toString() }
        val api = history.filter { Pos.str(it["priceMode"]) == "api" }.sortedByDescending { it["updatedAt"].toString() }
        return (manual.take(MAX_HISTORY_PER_MODE) + api.take(MAX_HISTORY_PER_MODE))
            .sortedByDescending { it["updatedAt"].toString() }.toMutableList()
    }

    private fun trimTicks(ticks: List<Doc>): MutableList<Doc> {
        val keepDates = (0..6).map { LocalDate.now().minusDays(it.toLong()).toString() }.toSet()
        val kept = ticks.filter { (it["date"]?.toString() in keepDates) || it["saved"] == true }
            .sortedWith(compareBy({ Pos.num(it["daySecond"]) }, { it["updatedAt"]?.toString() ?: "" }))
        return if (kept.size <= MAX_TICKS) kept.toMutableList() else kept.takeLast(MAX_TICKS).toMutableList()
    }

    fun read(): Doc {
        val row = jdbc.queryForList("SELECT ticks, history FROM shared_gold_rates WHERE id = ?", GLOBAL_ID).firstOrNull()
            ?: return newDoc("ticks" to mutableListOf<Any?>(), "history" to mutableListOf<Any?>())
        val ticks: List<Doc> = try {
            JSON.readValue(row["ticks"].toString(), ArrayList<Any?>().javaClass).asDocList()
        } catch (e: Exception) { mutableListOf() }
        val history: List<Doc> = try {
            JSON.readValue(row["history"].toString(), ArrayList<Any?>().javaClass).asDocList()
        } catch (e: Exception) { mutableListOf() }
        return newDoc(
            "ticks" to ticks.mapTo(mutableListOf<Any?>()) { normalizeTick(it) },
            "history" to history.mapTo(mutableListOf<Any?>()) { normalizeHistoryEntry(it) },
        )
    }

    fun write(data: Doc): Doc {
        val payload = newDoc(
            "ticks" to trimTicks(data["ticks"].asDocList().map { normalizeTick(it) }),
            "history" to trimHistory(data["history"].asDocList().map { normalizeHistoryEntry(it) }),
        )
        jdbc.update(
            """
            INSERT INTO shared_gold_rates (id, ticks, history, updated_at) VALUES (?, ?::jsonb, ?::jsonb, ?)
            ON CONFLICT (id) DO UPDATE SET ticks = EXCLUDED.ticks, history = EXCLUDED.history, updated_at = EXCLUDED.updated_at
            """.trimIndent(),
            GLOBAL_ID, JSON.writeValueAsString(payload["ticks"]), JSON.writeValueAsString(payload["history"]), Pos.nowIso(),
        )
        return payload
    }

    fun appendTicks(ticks: List<Any?>): Doc {
        if (ticks.isEmpty()) return newDoc("count" to 0)
        val data = read()
        val existing = data["ticks"].asDocList()
        var count = 0
        ticks.forEach { raw ->
            @Suppress("UNCHECKED_CAST")
            val tick = (raw as? MutableMap<String, Any?>) ?: return@forEach
            val normalized = normalizeTick(tick)
            val dupIdx = existing.indexOfFirst {
                it["date"] == normalized["date"] && it["priceMode"] == normalized["priceMode"] && it["daySecond"] == normalized["daySecond"]
            }
            if (dupIdx >= 0) existing[dupIdx] = normalized else existing.add(normalized)
            count++
        }
        data["ticks"] = existing
        write(data)
        return newDoc("count" to count)
    }

    fun appendHistory(entry: Doc): Doc {
        val tola = Pos.numOrNull(entry["goldRatePerTola"])
        if (tola == null || tola <= 0) return newDoc("changed" to false, "history" to mutableListOf<Any?>())
        val mode = if (Pos.str(entry["priceMode"]) == "api") "api" else "manual"
        var now = Pos.nowIso()
        val today = Pos.str(entry["localDate"] ?: entry["date"]).ifEmpty { now.take(10) }.take(10)
        val gram = Pos.num(entry["goldRatePerGram"]).takeIf { it != 0.0 } ?: Pos.round2(tola / Pos.TOLA_GRAMS)
        val data = read()
        val history = data["history"].asDocList().map { normalizeHistoryEntry(it) }.toMutableList()
        val lastForMode = history.filter { it["priceMode"] == mode }.maxByOrNull { it["updatedAt"].toString() }
        if (lastForMode != null
            && Pos.num(lastForMode["goldRatePerTola"]) == tola
            && Pos.num(lastForMode["goldRatePerGram"]) == gram
            && lastForMode["date"] == today
        ) {
            return newDoc("changed" to false, "history" to data["history"])
        }
        if (lastForMode != null) {
            try {
                val lastT = OffsetDateTime.parse(lastForMode["updatedAt"].toString()).toInstant()
                if (java.time.Instant.now().isBefore(lastT.plusSeconds(1))) {
                    now = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'.000Z'")
                        .withZone(ZoneOffset.UTC).format(lastT.plusSeconds(1))
                }
            } catch (e: Exception) { /* keep now */ }
        }
        history.add(newDoc("date" to today, "goldRatePerTola" to tola, "goldRatePerGram" to gram, "priceMode" to mode, "updatedAt" to now))
        data["history"] = trimHistory(history)
        val saved = write(data)
        return newDoc("changed" to true, "history" to saved["history"])
    }

    fun getForClient(date: String, priceMode: String): Doc {
        val data = read()
        val mode = if (priceMode == "api") "api" else "manual"
        val day = Pos.str(date).ifEmpty { localDateStr() }.take(10)
        val ticks = data["ticks"].asDocList()
            .filter { it["date"] == day && it["priceMode"] == mode }
            .sortedWith(compareBy({ Pos.num(it["daySecond"]) }, { it["updatedAt"]?.toString() ?: "" }))
        val history = data["history"].asDocList()
            .filter { it["priceMode"] == mode }
            .sortedByDescending { it["updatedAt"].toString() }
        return newDoc("ticks" to ticks, "history" to history)
    }

    fun clear(priceMode: String): Doc {
        val mode = if (priceMode == "api") "api" else "manual"
        val data = read()
        data["ticks"] = data["ticks"].asDocList().filter { it["priceMode"] != mode }.toMutableList()
        data["history"] = data["history"].asDocList().filter { it["priceMode"] != mode }.toMutableList()
        val saved = write(data)
        return newDoc("history" to saved["history"])
    }

    fun captureIfChanged(currency: Any?): Doc {
        if (!metal.isConfigured()) return newDoc("ok" to false, "skipped" to true, "reason" to "api_not_configured")
        val code = MetalRatesService.normalizeMetalCurrency(currency ?: System.getenv("CRON_METAL_CURRENCY") ?: "USD")
        val live = metal.getLiveRates(code)
        val goldDoc = (live["gold"] as? Map<*, *>)
        val tolaNpr = displayToNpr(goldDoc?.get("perTola"), code)
        val gramNpr = displayToNpr(goldDoc?.get("perGram"), code).takeIf { it != 0.0 } ?: Pos.round2(tolaNpr / Pos.TOLA_GRAMS)
        if (tolaNpr <= 0) return newDoc("ok" to false, "skipped" to true, "reason" to "invalid_rate")
        val result = appendHistory(newDoc(
            "goldRatePerTola" to tolaNpr, "goldRatePerGram" to gramNpr,
            "priceMode" to "api", "localDate" to localDateStr(),
        ))
        val nowLocal = java.time.LocalTime.now()
        appendTicks(listOf(newDoc(
            "date" to localDateStr(), "updatedAt" to Pos.nowIso(),
            "daySecond" to (nowLocal.hour * 3600 + nowLocal.minute * 60 + nowLocal.second).toLong(),
            "goldRatePerTola" to tolaNpr, "goldRatePerGram" to gramNpr,
            "priceMode" to "api", "saved" to (result["changed"] == true),
        )))
        return newDoc(
            "ok" to true, "changed" to result["changed"],
            "goldRatePerTola" to tolaNpr, "goldRatePerGram" to gramNpr,
            "currency" to code, "source" to live["source"], "liveUpdatedAt" to live["updatedAt"],
        )
    }
}
