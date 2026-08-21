package com.subarnapasal.store

import com.subarnapasal.common.ApiException
import com.subarnapasal.common.Doc
import com.subarnapasal.common.JSON
import com.subarnapasal.common.asDoc
import com.subarnapasal.common.asDocOrNull
import jakarta.servlet.http.HttpServletRequest
import org.springframework.beans.factory.annotation.Value
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.MessageDigest
import java.time.Duration

/**
 * SERVER role of the sync protocol (this deployment IS the central server):
 *   POST /api/sync/push  — receive a shop's data (token-authenticated)
 *   GET  /api/sync/pull  — hand a shop back its data (restore)
 *
 * The SHOP-role endpoints (run/status/restore) exist for API parity; on the
 * hosted microservice deployment there is no upstream to push to, so they
 * report not_configured — exactly what Laravel does without SYNC_SERVER_URL.
 */
@RestController
class SyncController(
    private val repo: StoreRepository,
    private val rates: RatesClient,
    @Value("\${auth.base-url}") private val authBaseUrl: String,
) {
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build()

    private fun authorized(request: HttpServletRequest): Boolean {
        val token = (System.getenv("SYNC_API_TOKEN") ?: "").trim()
        if (token.isEmpty()) return false
        val header = request.getHeader("Authorization") ?: ""
        val given = if (header.startsWith("Bearer ")) header.substring(7) else ""
        return given.isNotEmpty() && MessageDigest.isEqual(token.toByteArray(), given.toByteArray())
    }

    @PostMapping("/api/sync/push")
    fun push(request: HttpServletRequest, @RequestBody body: Doc): Any {
        if (!authorized(request)) throw ApiException("Sync token invalid.", 401)
        return when (val kind = body["kind"] ?: "store") {
            "store" -> {
                val userId = body["userId"]?.toString() ?: ""
                val store = body["store"].asDocOrNull()
                if (userId.isEmpty() || store == null) throw ApiException("userId and store are required.")
                repo.write(userId, store)
                mapOf("ok" to true, "kind" to "store", "userId" to userId)
            }
            "shared_rates" -> {
                val shared = body["sharedRates"].asDocOrNull() ?: throw ApiException("sharedRates is required.")
                rates.write(shared) ?: throw ApiException("rates-service is unavailable.", 502)
                mapOf("ok" to true, "kind" to "shared_rates")
            }
            "users" -> {
                // Account rows belong to auth-service; forward with the same token.
                val response = try {
                    http.send(
                        HttpRequest.newBuilder(URI.create(authBaseUrl.trimEnd('/') + "/internal/sync/users"))
                            .timeout(Duration.ofSeconds(10))
                            .header("Content-Type", "application/json")
                            .header("Authorization", request.getHeader("Authorization") ?: "")
                            .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)))
                            .build(),
                        HttpResponse.BodyHandlers.ofString(),
                    )
                } catch (e: Exception) {
                    throw ApiException("auth-service is unavailable.", 502)
                }
                if (response.statusCode() !in 200..299) throw ApiException("auth-service rejected the push.", 502)
                JSON.readValue(response.body(), LinkedHashMap<String, Any?>().javaClass)
            }
            else -> throw ApiException("Unknown sync kind.")
        }
    }

    @GetMapping("/api/sync/pull")
    fun pull(request: HttpServletRequest, @RequestParam(required = false) userId: String?): Any {
        if (!authorized(request)) throw ApiException("Sync token invalid.", 401)
        val uid = userId ?: ""
        if (uid.isEmpty()) throw ApiException("userId is required.")
        return mapOf(
            "ok" to true,
            "userId" to uid,
            "store" to repo.read(uid),
            "sharedRates" to rates.read(),
        )
    }

    @GetMapping("/api/sync/run")
    fun run(): Any = mapOf("ok" to false, "reason" to "not_configured")

    @GetMapping("/api/sync/status")
    fun status(): Any = mapOf(
        "configured" to false,
        "serverUrl" to null,
        "offlineUntil" to null,
        "entries" to emptyList<Any?>(),
    )

    @PostMapping("/api/sync/restore")
    fun restore(request: HttpServletRequest): Any {
        if (!authorized(request)) throw ApiException("Sync token invalid.", 401)
        return mapOf("ok" to false, "reason" to "not_configured")
    }
}
