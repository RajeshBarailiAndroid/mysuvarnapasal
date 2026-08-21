package com.subarnapasal.store

import com.subarnapasal.common.Doc
import com.subarnapasal.common.JSON
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * Thin HTTP client for rates-service's internal endpoints. Everything is
 * best-effort: the shop's own POS must keep working even if the shared
 * gold-rate feed is briefly down.
 */
@Component
class RatesClient(@Value("\${rates.base-url}") private val baseUrl: String) {

    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build()

    private fun request(method: String, path: String, body: Doc? = null): Doc? = try {
        val builder = HttpRequest.newBuilder(URI.create(baseUrl.trimEnd('/') + path))
            .timeout(Duration.ofSeconds(8))
            .header("Accept", "application/json")
        val req = when (method) {
            "GET" -> builder.GET()
            "DELETE" -> builder.DELETE()
            else -> builder.header("Content-Type", "application/json")
                .method(method, HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body ?: linkedMapOf<String, Any?>())))
        }.build()
        val response: HttpResponse<String> = http.send(req, HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() in 200..299) {
            JSON.readValue(response.body(), LinkedHashMap<String, Any?>().javaClass)
        } else null
    } catch (e: Exception) {
        null
    }

    fun read(): Doc = request("GET", "/internal/shared-rates") ?: linkedMapOf("ticks" to mutableListOf<Any?>(), "history" to mutableListOf<Any?>())

    fun appendHistory(entry: Doc): Doc? = request("POST", "/internal/shared-rates/history", entry)

    fun clear(priceMode: String): Doc? = request("DELETE", "/internal/shared-rates?priceMode=$priceMode")

    fun write(shared: Doc): Doc? = request("POST", "/internal/shared-rates/write", shared)
}
