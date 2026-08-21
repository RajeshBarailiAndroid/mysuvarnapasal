package com.subarnapasal.auth

import com.subarnapasal.common.ApiException
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice

@SpringBootApplication
class AuthApplication

fun main(args: Array<String>) {
    runApplication<AuthApplication>(*args)
}

@RestControllerAdvice
class ApiErrorAdvice {
    @ExceptionHandler(ApiException::class)
    fun handleApi(e: ApiException): ResponseEntity<Map<String, String?>> =
        ResponseEntity.status(e.status).body(mapOf("error" to e.message))
}
