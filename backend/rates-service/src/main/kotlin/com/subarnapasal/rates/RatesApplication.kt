package com.subarnapasal.rates

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
class RatesApplication {
    /** Only tick appends need a signed-in user (SECURITY note in Laravel routes). */
    @Bean
    fun attachUserFilter(): FilterRegistrationBean<AttachUserFilter> {
        val bean = FilterRegistrationBean(AttachUserFilter { path, method ->
            path == "/api/shared/gold-rates/ticks" && method == "POST"
        })
        bean.order = 1
        return bean
    }
}

fun main(args: Array<String>) {
    runApplication<RatesApplication>(*args)
}

@RestControllerAdvice
class ApiErrorAdvice {
    @ExceptionHandler(ApiException::class)
    fun handleApi(e: ApiException): ResponseEntity<Map<String, String?>> =
        ResponseEntity.status(e.status).body(mapOf("error" to e.message))
}
