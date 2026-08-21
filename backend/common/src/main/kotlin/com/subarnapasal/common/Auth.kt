package com.subarnapasal.common

import io.jsonwebtoken.Claims
import io.jsonwebtoken.Jwts
import io.jsonwebtoken.security.Keys
import jakarta.servlet.Filter
import jakarta.servlet.FilterChain
import jakarta.servlet.ServletRequest
import jakarta.servlet.ServletResponse
import jakarta.servlet.http.HttpServletRequest
import java.util.Date
import javax.crypto.SecretKey

/**
 * Stateless JWT auth shared by every service (the microservice replacement
 * for Sanctum's DB-backed tokens). auth-service issues tokens; every service
 * validates them locally with the shared JWT_SECRET.
 *
 * AUTH_ENABLED=false keeps the single-shop desktop mode: every request runs
 * as the 'local-dev' user, exactly like the Laravel AttachUser middleware.
 */
object AuthSupport {
    const val LOCAL_DEV_USER_ID = "local-dev"
    const val ATTR_USER_ID = "sp.userId"
    const val ATTR_TOKEN_VERSION = "sp.tokenVersion"

    fun authEnabled(): Boolean =
        (System.getenv("AUTH_ENABLED") ?: "true").lowercase() !in listOf("false", "0", "no", "off")

    fun secretKey(): SecretKey {
        val raw = System.getenv("JWT_SECRET")
            ?: "subarnapasal-dev-secret-change-me-in-production-0123456789"
        // HS256 needs >= 32 bytes; pad deterministically if someone sets a short secret.
        val bytes = raw.toByteArray().let { if (it.size >= 32) it else it + ByteArray(32 - it.size) }
        return Keys.hmacShaKeyFor(bytes)
    }

    fun tokenTtlDays(): Long = (System.getenv("JWT_TTL_DAYS") ?: "30").toLongOrNull() ?: 30

    fun issueToken(userId: String, username: String, name: String, tokenVersion: Long): String =
        Jwts.builder()
            .subject(userId)
            .claim("username", username)
            .claim("name", name)
            .claim("ver", tokenVersion)
            .issuedAt(Date())
            .expiration(Date(System.currentTimeMillis() + tokenTtlDays() * 24 * 3600 * 1000))
            .signWith(secretKey())
            .compact()

    fun parseToken(token: String): Claims? = try {
        Jwts.parser().verifyWith(secretKey()).build().parseSignedClaims(token).payload
    } catch (e: Exception) {
        null
    }

    fun bearerToken(request: HttpServletRequest): String? {
        val header = request.getHeader("Authorization") ?: return null
        return if (header.startsWith("Bearer ")) header.substring(7).takeIf { it.isNotEmpty() } else null
    }

    /** Resolve the acting user id, or null when a valid token is required but absent. */
    fun resolveUserId(request: HttpServletRequest): String? {
        if (!authEnabled()) return LOCAL_DEV_USER_ID
        val token = bearerToken(request) ?: return null
        val claims = parseToken(token) ?: return null
        return claims.subject
    }
}

class ApiException(message: String, val status: Int = 400) : RuntimeException(message)

/**
 * Servlet filter that mirrors Laravel's attach.user middleware: attaches the
 * user id for authenticated paths, 401s otherwise. Each service passes the
 * path predicate for its protected routes.
 */
class AttachUserFilter(private val requiresAuth: (path: String, method: String) -> Boolean) : Filter {
    override fun doFilter(request: ServletRequest, response: ServletResponse, chain: FilterChain) {
        val req = request as HttpServletRequest
        val path = req.requestURI
        if (!requiresAuth(path, req.method)) {
            chain.doFilter(request, response)
            return
        }
        val userId = AuthSupport.resolveUserId(req)
        if (userId == null) {
            val res = response as jakarta.servlet.http.HttpServletResponse
            res.status = 401
            res.contentType = "application/json"
            res.writer.write("{\"error\":\"Sign in required.\"}")
            return
        }
        req.setAttribute(AuthSupport.ATTR_USER_ID, userId)
        chain.doFilter(request, response)
    }
}

fun HttpServletRequest.userId(): String =
    (getAttribute(AuthSupport.ATTR_USER_ID) as? String) ?: AuthSupport.LOCAL_DEV_USER_ID
