package com.subarnapasal.store

import com.subarnapasal.common.Doc
import com.subarnapasal.common.JSON
import com.subarnapasal.common.Pos
import com.subarnapasal.common.asDoc
import com.subarnapasal.common.listAt
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Repository
import org.springframework.transaction.support.TransactionTemplate

/**
 * Per-user store document backed by a single JSONB row. Mirrors the shape
 * the PHP Store class produced: settings, items, transactions, orders,
 * customers + JSON collections (karigars, goldLedger, oldGoldExchanges,
 * options, sales, repairs, schemes, requests).
 */
@Repository
class StoreRepository(private val jdbc: JdbcTemplate, private val tx: TransactionTemplate) {

    companion object {
        val COLLECTIONS = listOf(
            "items", "transactions", "orders", "customers",
            "karigars", "goldLedger", "oldGoldExchanges", "options",
            "sales", "repairs", "schemes", "requests",
        )
    }

    private fun defaults(): Doc {
        val doc: Doc = linkedMapOf("settings" to Pos.defaultSettings())
        COLLECTIONS.forEach { doc[it] = mutableListOf<Any?>() }
        return doc
    }

    private fun normalize(doc: Doc): Doc {
        if (doc["settings"] !is MutableMap<*, *>) doc["settings"] = Pos.defaultSettings()
        COLLECTIONS.forEach { doc.listAt(it) }
        return doc
    }

    fun read(userId: String): Doc {
        val rows = jdbc.queryForList("SELECT doc FROM store_docs WHERE user_id = ?", userId)
        if (rows.isEmpty()) return defaults()
        return try {
            normalize(JSON.readValue(rows[0]["doc"].toString(), LinkedHashMap<String, Any?>().javaClass))
        } catch (e: Exception) {
            defaults()
        }
    }

    fun write(userId: String, doc: Doc) {
        jdbc.update(
            """
            INSERT INTO store_docs (user_id, doc, updated_at) VALUES (?, ?::jsonb, now())
            ON CONFLICT (user_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()
            """.trimIndent(),
            userId, JSON.writeValueAsString(normalize(doc)),
        )
    }

    /**
     * Read-modify-write under a row lock — the checkout atomicity guarantee.
     * The block mutates the doc; return value is passed through.
     */
    fun <T> update(userId: String, block: (Doc) -> T): T = tx.execute {
        val rows = jdbc.queryForList("SELECT doc FROM store_docs WHERE user_id = ? FOR UPDATE", userId)
        val doc = if (rows.isEmpty()) defaults() else try {
            normalize(JSON.readValue(rows[0]["doc"].toString(), LinkedHashMap<String, Any?>().javaClass))
        } catch (e: Exception) { defaults() }
        val result = block(doc)
        write(userId, doc)
        result
    }!!

    fun ensureUserSettings(userId: String) {
        val exists = (jdbc.queryForObject("SELECT count(*) FROM store_docs WHERE user_id = ?", Long::class.java, userId) ?: 0) > 0
        if (!exists) write(userId, defaults())
    }

    fun isShopNameTaken(shopName: String, excludeUserId: String): Boolean {
        val normalized = Pos.normalizeShopName(shopName)
        if (normalized.isEmpty()) return false
        val count = jdbc.queryForObject(
            "SELECT count(*) FROM store_docs WHERE user_id != ? AND LOWER(doc->'settings'->>'shopName') = ?",
            Long::class.java, excludeUserId, normalized,
        ) ?: 0
        return count > 0
    }

    fun allUserIds(): List<String> =
        jdbc.queryForList("SELECT user_id FROM store_docs", String::class.java)
}
