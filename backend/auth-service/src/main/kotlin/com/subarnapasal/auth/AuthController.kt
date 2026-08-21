package com.subarnapasal.auth

import com.subarnapasal.common.ApiException
import com.subarnapasal.common.AuthSupport
import com.subarnapasal.common.Doc
import com.subarnapasal.common.Pos
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

/**
 * Username/password auth issuing JWTs. Endpoint paths and response shapes
 * mirror the Laravel AuthController so the frontend needs zero changes.
 */
@RestController
@RequestMapping("/api/auth")
class AuthController(private val users: UserRepository) {

    private val encoder = BCryptPasswordEncoder()

    companion object {
        fun normalizeUsername(value: Any?): String =
            (value?.toString() ?: "").trim().lowercase().replace(Regex("\\s+"), "")

        fun isValidUsername(username: String) = Regex("^[a-z0-9_]{3,24}$").matches(username)
        fun isValidEmail(email: String) = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(email)
        fun isValidPassword(password: String) = password.length in 6..128
    }

    private fun sessionPayload(user: User, token: String): Doc = linkedMapOf<String, Any?>(
        "access_token" to token,
        "token_type" to "bearer",
        "user" to linkedMapOf<String, Any?>(
            "id" to user.id.toString(),
            "email" to user.email,
            "user_metadata" to linkedMapOf<String, Any?>(
                "username" to user.username,
                "full_name" to user.name,
                "phone" to user.phone,
            ),
        ),
    )

    private fun issue(user: User): String =
        AuthSupport.issueToken(user.id.toString(), user.username, user.name, user.tokenVersion)

    @GetMapping("/config")
    fun config() = mapOf("enabled" to AuthSupport.authEnabled(), "driver" to "jwt")

    @PostMapping("/signup")
    fun signup(@RequestBody body: Doc): ResponseEntity<Any> {
        if (!AuthSupport.authEnabled()) throw ApiException("Sign-in is not configured yet.", 503)
        val username = normalizeUsername(body["username"])
        val fullName = Pos.str(body["full_name"])
        val email = Pos.str(body["email"])
        val phone = Pos.str(body["phone"])
        val password = body["password"]?.toString() ?: ""
        if (!isValidUsername(username)) throw ApiException("Username must be 3–24 characters (letters, numbers, underscore).")
        if (fullName.isEmpty()) throw ApiException("Enter your full name.")
        if (email.isEmpty() && phone.isEmpty()) throw ApiException("Enter an email address or mobile number.")
        if (email.isNotEmpty() && !isValidEmail(email)) throw ApiException("Enter a valid email address.")
        if (phone.isNotEmpty() && !Pos.isValidPhoneForRegion(phone, body["phoneRegion"])) {
            throw ApiException(Pos.phoneErrorMessage(Pos.normalizePhoneRegion(body["phoneRegion"])))
        }
        if (!isValidPassword(password)) throw ApiException("Password must be at least 6 characters.")
        if (users.usernameExists(username)) throw ApiException("That username is already taken.", 409)
        val user = users.create(
            name = fullName, username = username,
            email = email.ifEmpty { null }?.lowercase(), phone = phone.ifEmpty { null },
            passwordHash = encoder.encode(password),
        )
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(mapOf("ok" to true, "session" to sessionPayload(user, issue(user))))
    }

    @PostMapping("/login")
    fun login(@RequestBody body: Doc): Any {
        if (!AuthSupport.authEnabled()) throw ApiException("Sign-in is not configured yet.", 503)
        val username = normalizeUsername(body["username"])
        val password = body["password"]?.toString() ?: ""
        if (!isValidUsername(username) || !isValidPassword(password)) {
            throw ApiException("Incorrect username or password.", 400)
        }
        val user = users.findByUsername(username)
        if (user == null || !encoder.matches(password, user.passwordHash)) {
            throw ApiException("Incorrect username or password.", 401)
        }
        return mapOf("ok" to true, "session" to sessionPayload(user, issue(user)))
    }

    private fun currentUser(request: HttpServletRequest): User {
        val token = AuthSupport.bearerToken(request) ?: throw ApiException("Authorization required.", 401)
        val claims = AuthSupport.parseToken(token) ?: throw ApiException("Authorization required.", 401)
        val user = claims.subject.toLongOrNull()?.let(users::findById) ?: throw ApiException("Authorization required.", 401)
        val ver = (claims["ver"] as? Number)?.toLong() ?: 0
        if (ver != user.tokenVersion) throw ApiException("Authorization required.", 401)
        return user
    }

    @GetMapping("/me")
    fun me(request: HttpServletRequest): Any {
        if (!AuthSupport.authEnabled()) throw ApiException("Sign-in is not configured yet.", 503)
        val user = currentUser(request)
        return mapOf("ok" to true, "displayName" to user.name, "username" to user.username)
    }

    @PostMapping("/logout")
    fun logout(): Any {
        // JWTs are stateless; the client discards the token. Change-password
        // still hard-revokes everywhere via token_version.
        return mapOf("ok" to true)
    }

    @PostMapping("/change-password")
    fun changePassword(request: HttpServletRequest, @RequestBody body: Doc): Any {
        if (!AuthSupport.authEnabled()) throw ApiException("Sign-in is not configured yet.", 503)
        val user = currentUser(request)
        val currentPassword = body["currentPassword"]?.toString() ?: ""
        val password = body["password"]?.toString() ?: ""
        val confirm = body["confirm"]?.toString() ?: ""
        if (!isValidPassword(currentPassword)) throw ApiException("Enter your current password.")
        if (!isValidPassword(password)) throw ApiException("Password must be at least 6 characters.")
        if (password != confirm) throw ApiException("Passwords do not match.")
        if (password == currentPassword) throw ApiException("Choose a different password.")
        if (!encoder.matches(currentPassword, user.passwordHash)) throw ApiException("Current password is incorrect.", 401)
        users.updatePassword(user.id, encoder.encode(password))
        return mapOf("ok" to true, "message" to "Password updated.")
    }

    @PostMapping("/forgot-password")
    fun forgotPassword(): Any = mapOf(
        "ok" to true,
        "message" to "If an account matches, a reset link was sent to your email. Check your inbox and spam folder.",
    )
}
