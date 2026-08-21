package com.subarnapasal.store

import com.subarnapasal.common.ApiException
import com.subarnapasal.common.AttachUserFilter
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.context.annotation.Bean
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice

@SpringBootApplication
class StoreApplication {

    /** Public paths mirror routes/api.php; everything else under /api needs a user. */
    @Bean
    fun attachUserFilter(): FilterRegistrationBean<AttachUserFilter> {
        val publicPrefixes = listOf("/api/public/", "/api/sync/")
        val publicExact = setOf("/api/health", "/api/healthz")
        val bean = FilterRegistrationBean(AttachUserFilter { path, _ ->
            path.startsWith("/api/")
                && path !in publicExact
                && publicPrefixes.none { path.startsWith(it) }
        })
        bean.order = 1
        return bean
    }
}

fun main(args: Array<String>) {
    runApplication<StoreApplication>(*args)
}

@RestControllerAdvice
class ApiErrorAdvice {
    @ExceptionHandler(ApiException::class)
    fun handleApi(e: ApiException): ResponseEntity<Map<String, String?>> =
        ResponseEntity.status(e.status).body(mapOf("error" to e.message))
}
