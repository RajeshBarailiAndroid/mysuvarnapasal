package com.subarnapasal.gateway

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

/**
 * Single entry point for the SubarnaPasal API. Routes preserve the exact
 * /api/... paths the frontend already uses — swap the Laravel base URL for
 * the gateway URL and nothing else changes.
 */
@SpringBootApplication
class GatewayApplication

fun main(args: Array<String>) {
    runApplication<GatewayApplication>(*args)
}
