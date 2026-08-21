package com.subarnapasal.auth

import com.subarnapasal.common.ApiException
import com.subarnapasal.common.Doc
import com.subarnapasal.common.JSON
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.time.LocalDate
import java.util.Base64

/**
 * Server-side licensing for the desktop app (Ed25519 signed keys), ported
 * from the Laravel LicenseController. Same env contract:
 *   LICENSE_PRIVATE_SEED  base64 32-byte Ed25519 seed (KEEP SECRET)
 *   LICENSE_PUBLIC_KEY    base64 32-byte Ed25519 public key
 *   SYNC_API_TOKEN        admin bearer token for issue/list/revoke
 */
@RestController
@RequestMapping("/api/license")
class LicenseController(private val jdbc: JdbcTemplate, private val users: UserRepository) {

    private val encoder = BCryptPasswordEncoder()

    // ── Ed25519 plumbing (raw 32-byte seed/public key <-> JCA keys) ──────

    private val pkcs8Prefix = byteArrayOf(
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    )
    private val x509Prefix = byteArrayOf(
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    )

    private fun privateKey(): PrivateKey? {
        val b64 = System.getenv("LICENSE_PRIVATE_SEED") ?: return null
        val seed = try { Base64.getDecoder().decode(b64) } catch (e: Exception) { return null }
        if (seed.size != 32) return null
        return KeyFactory.getInstance("Ed25519").generatePrivate(PKCS8EncodedKeySpec(pkcs8Prefix + seed))
    }

    private fun publicKey(): PublicKey? {
        val b64 = System.getenv("LICENSE_PUBLIC_KEY") ?: return null
        val raw = try { Base64.getDecoder().decode(b64) } catch (e: Exception) { return null }
        if (raw.size != 32) return null
        return KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(x509Prefix + raw))
    }

    private fun sign(sk: PrivateKey, payload: ByteArray): ByteArray =
        Signature.getInstance("Ed25519").apply { initSign(sk); update(payload) }.sign()

    private fun verify(pk: PublicKey, payload: ByteArray, sig: ByteArray): Boolean = try {
        Signature.getInstance("Ed25519").apply { initVerify(pk); update(payload) }.verify(sig)
    } catch (e: Exception) { false }

    private fun b64u(bin: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bin)
    private fun b64uDecode(s: String): ByteArray? = try { Base64.getUrlDecoder().decode(s) } catch (e: Exception) { null }
    private fun sha256Hex(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun adminAuthorized(request: HttpServletRequest): Boolean {
        val token = (System.getenv("SYNC_API_TOKEN") ?: "").trim()
        if (token.isEmpty()) return false
        val header = request.getHeader("Authorization") ?: ""
        val given = if (header.startsWith("Bearer ")) header.substring(7) else ""
        return given.isNotEmpty() && MessageDigest.isEqual(token.toByteArray(), given.toByteArray())
    }

    /** Verify an SP.<payload>.<sig> key. Returns payload doc or null. */
    private fun verifyKey(key: String): Doc? {
        val pk = publicKey() ?: return null
        val clean = key.replace(Regex("\\s+"), "")
        val parts = clean.split(".")
        if (parts.size != 3 || parts[0] != "SP") return null
        val payload = b64uDecode(parts[1]) ?: return null
        val sig = b64uDecode(parts[2]) ?: return null
        if (sig.size != 64 || !verify(pk, payload, sig)) return null
        val data: Doc = try { JSON.readValue(payload, LinkedHashMap<String, Any?>().javaClass) } catch (e: Exception) { return null }
        val expiry = data["e"]?.toString() ?: return null
        if (!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(expiry)) return null
        return data
    }

    private fun issueKey(sk: PrivateKey, shopName: String, expiry: String, note: String?): Pair<String, Long> {
        val payload = JSON.writeValueAsBytes(linkedMapOf("n" to shopName, "e" to expiry, "i" to LocalDate.now().toString()))
        val key = "SP." + b64u(payload) + "." + b64u(sign(sk, payload))
        val id = jdbc.queryForObject(
            "INSERT INTO licenses (shop_name, key_hash, license_key, expiry, revoked, note) VALUES (?,?,?,?,false,?) RETURNING id",
            Long::class.java, shopName, sha256Hex(key), key, expiry, note,
        )!!
        return key to id
    }

    private fun recordActivation(licenseId: Long, deviceId: String, body: Doc) {
        jdbc.update(
            """
            INSERT INTO license_activations (license_id, device_id, device_name, app_version, activated_at, last_seen_at)
            VALUES (?,?,?,?,now(),now())
            ON CONFLICT (license_id, device_id) DO UPDATE SET
              device_name = EXCLUDED.device_name, app_version = EXCLUDED.app_version,
              activated_at = now(), last_seen_at = now(), updated_at = now()
            """.trimIndent(),
            licenseId, deviceId,
            (body["deviceName"]?.toString() ?: "").take(190),
            (body["appVersion"]?.toString() ?: "").take(30),
        )
    }

    private fun receiptFor(sk: PrivateKey, key: String, deviceId: String): String {
        val payload = JSON.writeValueAsBytes(linkedMapOf(
            "v" to 1, "kh" to sha256Hex(key), "d" to deviceId, "t" to java.time.OffsetDateTime.now().toString(),
        ))
        return b64u(payload) + "." + b64u(sign(sk, payload))
    }

    // ── App: first-run SIGNUP → account + 1-year key + activation ────────

    @PostMapping("/signup")
    fun signup(@RequestBody body: Doc): ResponseEntity<Any> {
        val sk = privateKey() ?: throw ApiException("This server is not configured for license activation.", 500)
        val shopName = (body["shopName"]?.toString() ?: "").trim()
        val username = AuthController.normalizeUsername(body["username"])
        val phone = (body["phone"]?.toString() ?: "").trim()
        val email = (body["email"]?.toString() ?: "").trim().lowercase()
        val password = body["password"]?.toString() ?: ""
        val deviceId = (body["deviceId"]?.toString() ?: "").trim()

        if (shopName.isEmpty()) throw ApiException("Enter your shop name.")
        if (!AuthController.isValidUsername(username)) {
            throw ApiException("Username must be 3–24 characters (letters, numbers, underscore).")
        }
        if (password.length !in 6..128) throw ApiException("Password must be at least 6 characters.")
        if (deviceId.isEmpty() || deviceId.length > 64) throw ApiException("deviceId is required.")
        if (users.usernameExists(username)) {
            throw ApiException("That username is already taken. If this is your shop, use \"Already have a license key?\" instead.", 409)
        }

        val user = users.create(shopName, username, email.ifEmpty { null }, phone.ifEmpty { null }, encoder.encode(password))
        val expiry = LocalDate.now().plusYears(1).toString()
        val (key, licenseId) = issueKey(sk, shopName, expiry, "signup: $username (user #${user.id})")
        recordActivation(licenseId, deviceId, body)

        return ResponseEntity.status(HttpStatus.CREATED).body(mapOf(
            "ok" to true, "key" to key, "receipt" to receiptFor(sk, key, deviceId),
            "expiry" to expiry, "shopName" to shopName, "username" to username,
        ))
    }

    // ── Admin: issue / list / reveal / revoke ────────────────────────────

    @PostMapping("/issue")
    fun issue(request: HttpServletRequest, @RequestBody body: Doc): Any {
        if (!adminAuthorized(request)) throw ApiException("Admin token invalid.", 401)
        val sk = privateKey() ?: throw ApiException("LICENSE_PRIVATE_SEED is not configured on this server.", 500)
        val shopName = (body["shopName"]?.toString() ?: "").trim()
        if (shopName.isEmpty()) throw ApiException("shopName is required.")
        var expiry = body["expiry"]?.toString() ?: ""
        if (!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(expiry)) {
            val days = (body["days"] as? Number)?.toInt() ?: body["days"]?.toString()?.toIntOrNull() ?: 0
            if (days < 1) throw ApiException("Provide expiry (YYYY-MM-DD) or days (>0).")
            expiry = LocalDate.now().plusDays(days.toLong()).toString()
        }
        val (key, id) = issueKey(sk, shopName, expiry, body["note"]?.toString())
        return mapOf("ok" to true, "id" to id, "shopName" to shopName, "expiry" to expiry, "key" to key)
    }

    @GetMapping("/list")
    fun list(request: HttpServletRequest): Any {
        if (!adminAuthorized(request)) throw ApiException("Admin token invalid.", 401)
        val licenses = jdbc.queryForList("SELECT * FROM licenses ORDER BY id DESC").map { row ->
            val m = LinkedHashMap<String, Any?>(row)
            val key = m.remove("license_key")?.toString() ?: ""
            // SECURITY: never bulk-dump working license keys.
            m["license_key_masked"] = if (key.isEmpty()) "" else "SP.…" + key.takeLast(8)
            m["activations"] = jdbc.queryForList(
                "SELECT * FROM license_activations WHERE license_id = ? ORDER BY activated_at DESC", m["id"],
            )
            m
        }
        return mapOf("ok" to true, "licenses" to licenses)
    }

    @PostMapping("/reveal")
    fun reveal(request: HttpServletRequest, @RequestBody body: Doc): Any {
        if (!adminAuthorized(request)) throw ApiException("Admin token invalid.", 401)
        val id = (body["id"] as? Number)?.toLong() ?: body["id"]?.toString()?.toLongOrNull() ?: 0
        val rows = jdbc.queryForList("SELECT license_key FROM licenses WHERE id = ?", id)
        if (rows.isEmpty()) throw ApiException("License not found.", 404)
        return mapOf("ok" to true, "id" to id, "key" to rows[0]["license_key"])
    }

    @PostMapping("/revoke")
    fun revoke(request: HttpServletRequest, @RequestBody body: Doc): Any = setRevoked(request, body, true)

    @PostMapping("/unrevoke")
    fun unrevoke(request: HttpServletRequest, @RequestBody body: Doc): Any = setRevoked(request, body, false)

    private fun setRevoked(request: HttpServletRequest, body: Doc, flag: Boolean): Any {
        if (!adminAuthorized(request)) throw ApiException("Admin token invalid.", 401)
        val id = (body["id"] as? Number)?.toLong() ?: body["id"]?.toString()?.toLongOrNull() ?: 0
        val n = jdbc.update("UPDATE licenses SET revoked = ?, updated_at = now() WHERE id = ?", flag, id)
        if (n == 0) throw ApiException("License not found.", 404)
        return mapOf("ok" to true, "id" to id, "revoked" to flag)
    }

    // ── App: activation + periodic check ─────────────────────────────────

    @PostMapping("/activate")
    fun activate(@RequestBody body: Doc): Any {
        val sk = privateKey() ?: throw ApiException("This server is not configured for license activation.", 500)
        val key = (body["key"]?.toString() ?: "").replace(Regex("\\s+"), "")
        val deviceId = (body["deviceId"]?.toString() ?: "").trim()
        if (key.isEmpty() || deviceId.isEmpty() || deviceId.length > 64) {
            throw ApiException("key and deviceId are required.")
        }
        val data = verifyKey(key) ?: throw ApiException("This license key is not valid.", 422)
        val keyHash = sha256Hex(key)
        var license = jdbc.queryForList("SELECT * FROM licenses WHERE key_hash = ?", keyHash).firstOrNull()
        if (license == null) {
            // Signed with our private key but issued offline — register it.
            val id = jdbc.queryForObject(
                "INSERT INTO licenses (shop_name, key_hash, license_key, expiry, revoked, note) VALUES (?,?,?,?,false,'auto-registered at activation') RETURNING id",
                Long::class.java, data["n"]?.toString() ?: "", keyHash, key, data["e"].toString(),
            )
            license = jdbc.queryForList("SELECT * FROM licenses WHERE id = ?", id).first()
        }
        if (license["revoked"] == true) throw ApiException("This license has been disabled. Please contact SubarnaPasal.", 403)
        val expiry = data["e"].toString()
        if (expiry < LocalDate.now().minusDays(7).toString()) {
            throw ApiException("This license key expired on $expiry. Please request a renewal key.", 403)
        }
        recordActivation((license["id"] as Number).toLong(), deviceId, body)
        return mapOf("ok" to true, "receipt" to receiptFor(sk, key, deviceId), "expiry" to expiry)
    }

    @PostMapping("/check")
    fun check(@RequestBody body: Doc): Any {
        val key = (body["key"]?.toString() ?: "").replace(Regex("\\s+"), "")
        val deviceId = (body["deviceId"]?.toString() ?: "").trim()
        if (key.isEmpty()) throw ApiException("key is required.")
        val license = jdbc.queryForList("SELECT * FROM licenses WHERE key_hash = ?", sha256Hex(key)).firstOrNull()
        val revoked = license?.get("revoked") == true
        if (license != null && deviceId.isNotEmpty()) {
            jdbc.update(
                "UPDATE license_activations SET last_seen_at = now(), updated_at = now() WHERE license_id = ? AND device_id = ?",
                license["id"], deviceId,
            )
        }
        return mapOf("ok" to true, "revoked" to revoked)
    }
}

/** Receives replicated account rows from desktop installs (sync push kind=users). */
@RestController
class InternalSyncController(private val users: UserRepository) {
    @PostMapping("/internal/sync/users")
    fun syncUsers(request: HttpServletRequest, @RequestBody body: Doc): Any {
        val token = (System.getenv("SYNC_API_TOKEN") ?: "").trim()
        val header = request.getHeader("Authorization") ?: ""
        val given = if (header.startsWith("Bearer ")) header.substring(7) else ""
        if (token.isEmpty() || given != token) throw ApiException("Sync token invalid.", 401)
        val list = (body["users"] as? List<*>) ?: emptyList<Any?>()
        var count = 0
        list.forEach { u ->
            @Suppress("UNCHECKED_CAST")
            val row = u as? Map<String, Any?> ?: return@forEach
            // SECURITY: password / remember_token are deliberately ignored.
            users.upsertSynced(row.filterKeys { it in setOf("id", "name", "username", "phone", "email", "email_verified_at", "created_at", "updated_at") })
            count++
        }
        return mapOf("ok" to true, "kind" to "users", "count" to count)
    }
}
