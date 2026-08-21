package com.subarnapasal.auth

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Repository
import java.sql.ResultSet

data class User(
    val id: Long,
    val name: String,
    val username: String,
    val email: String?,
    val phone: String?,
    val passwordHash: String,
    val tokenVersion: Long,
)

@Repository
class UserRepository(private val jdbc: JdbcTemplate) {

    private fun map(rs: ResultSet) = User(
        id = rs.getLong("id"),
        name = rs.getString("name"),
        username = rs.getString("username"),
        email = rs.getString("email"),
        phone = rs.getString("phone"),
        passwordHash = rs.getString("password"),
        tokenVersion = rs.getLong("token_version"),
    )

    fun findByUsername(username: String): User? =
        jdbc.query("SELECT * FROM users WHERE username = ?", { rs, _ -> map(rs) }, username).firstOrNull()

    fun findById(id: Long): User? =
        jdbc.query("SELECT * FROM users WHERE id = ?", { rs, _ -> map(rs) }, id).firstOrNull()

    fun usernameExists(username: String): Boolean =
        (jdbc.queryForObject("SELECT count(*) FROM users WHERE username = ?", Long::class.java, username) ?: 0) > 0

    fun create(name: String, username: String, email: String?, phone: String?, passwordHash: String): User {
        val id = jdbc.queryForObject(
            "INSERT INTO users (name, username, email, phone, password) VALUES (?,?,?,?,?) RETURNING id",
            Long::class.java, name, username, email, phone, passwordHash,
        )!!
        return findById(id)!!
    }

    fun updatePassword(id: Long, passwordHash: String) {
        // Bumping token_version invalidates every previously issued JWT —
        // the microservice equivalent of Sanctum's "delete all tokens".
        jdbc.update(
            "UPDATE users SET password = ?, token_version = token_version + 1, updated_at = now() WHERE id = ?",
            passwordHash, id,
        )
    }

    /** Upsert an account row replicated from a desktop install (sync push kind=users). */
    fun upsertSynced(row: Map<String, Any?>) {
        val id = (row["id"] as? Number)?.toLong() ?: row["id"]?.toString()?.toLongOrNull() ?: return
        jdbc.update(
            """
            INSERT INTO users (id, name, username, email, phone, password)
            VALUES (?, ?, ?, ?, ?, '!synced-no-local-login!')
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name, username = EXCLUDED.username,
              email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = now()
            """.trimIndent(),
            id,
            row["name"]?.toString() ?: "",
            row["username"]?.toString() ?: "user-$id",
            row["email"]?.toString(),
            row["phone"]?.toString(),
        )
        jdbc.execute("SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1))")
    }
}
