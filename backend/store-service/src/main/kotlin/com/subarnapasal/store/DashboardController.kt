package com.subarnapasal.store

import com.subarnapasal.common.Doc
import com.subarnapasal.common.Pos
import com.subarnapasal.common.asDoc
import com.subarnapasal.common.asDocList
import com.subarnapasal.common.newDoc
import com.subarnapasal.common.userId
import jakarta.servlet.http.HttpServletRequest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

@RestController
class DashboardController(private val repo: StoreRepository, private val jdbc: JdbcTemplate) {

    private val dayFmt = DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneOffset.UTC)

    /** Single aggregate call for the home screen. */
    @GetMapping("/api/dashboard")
    fun show(request: HttpServletRequest): Any {
        val store = repo.read(request.userId())
        val metals = Pos.resolveMetalRates(store)
        val today = dayFmt.format(Instant.now())
        val monthStart = today.take(8) + "01"

        val sales = store["sales"].asDocList().filter { Pos.str(it["status"]) != "voided" }
        val revenueSales = sales.filter { Pos.str(it["type"]) != "opening_due" }
        fun sumTotals(list: List<Doc>) = list.sumOf { Pos.num(it["total"]) }
        val todaySales = revenueSales.filter { (it["createdAt"]?.toString() ?: "").take(10) == today }
        val monthSales = revenueSales.filter { (it["createdAt"]?.toString() ?: "").take(10) >= monthStart }

        val salesByDay = (0..6).map { i ->
            val d = dayFmt.format(Instant.now().minusSeconds(((6 - i) * 86400).toLong()))
            val daySales = revenueSales.filter { (it["createdAt"]?.toString() ?: "").take(10) == d }
            newDoc("date" to d, "amount" to sumTotals(daySales), "count" to daySales.size)
        }

        val outstandingTotal = sales.sumOf { Pos.saleDueRemaining(it) }
        val openDues = mutableListOf<Doc>()
        for (s in sales) {
            if (Pos.saleDueRemaining(s) <= 0) continue
            openDues.add(newDoc(
                "id" to s["id"], "invoiceNumber" to s["invoiceNumber"], "customerName" to s["customerName"],
                "dueRemaining" to Pos.saleDueRemaining(s), "createdAt" to s["createdAt"],
            ))
            if (openDues.size >= 6) break
        }

        val allItems = store["items"].asDocList()
        val inStock = allItems.filter { Pos.str(it["status"]) == "in_stock" && Pos.num(it["quantity"]) > 0 }
        var inventoryValue = 0.0
        var totalWeightGrams = 0.0
        var itemCount = 0.0
        inStock.forEach { i ->
            inventoryValue += Pos.itemValue(i, metals) * Pos.num(i["quantity"])
            totalWeightGrams += Pos.num(i["weightGrams"]) * Pos.num(i["quantity"])
            itemCount += Pos.num(i["quantity"])
        }
        val lowStockCount = allItems.count { Pos.str(it["status"]) == "in_stock" && Pos.num(it["quantity"]) <= 1 }

        val pendingOrders = store["orders"].asDocList()
            .count { Pos.str(it["status"]) in listOf("pending", "confirmed", "progress", "ready") }
        val activeRepairs = store["repairs"].asDocList()
            .count { Pos.str(it["status"]) in listOf("received", "in_progress", "ready") }
        val activeSchemes = store["schemes"].asDocList()
            .count { Pos.str(it["status"]) in listOf("active", "matured") }

        val recentSales = sales.take(6).map { s ->
            newDoc(
                "id" to s["id"], "invoiceNumber" to s["invoiceNumber"], "customerName" to s["customerName"],
                "total" to (s["total"] ?: 0), "method" to ((s["payment"] as? Map<*, *>)?.get("method") ?: "cash"),
                "dueRemaining" to Pos.saleDueRemaining(s), "createdAt" to s["createdAt"],
            )
        }

        return newDoc(
            "date" to today,
            "goldRatePerTola" to Pos.num(metals["goldRatePerTola"]),
            "silverRatePerTola" to Pos.num(metals["silverRatePerTola"]),
            "metalRatesLive" to (metals["live"] == true),
            "today" to newDoc("revenue" to sumTotals(todaySales), "count" to todaySales.size),
            "month" to newDoc("revenue" to sumTotals(monthSales), "count" to monthSales.size),
            "salesByDay" to salesByDay,
            "outstandingTotal" to outstandingTotal, "openDues" to openDues,
            "inventory" to newDoc(
                "value" to inventoryValue, "items" to itemCount,
                "weightGrams" to Pos.round2(totalWeightGrams), "lowStockCount" to lowStockCount,
            ),
            "pendingOrders" to pendingOrders, "activeRepairs" to activeRepairs, "activeSchemes" to activeSchemes,
            "recentSales" to recentSales,
        )
    }

    @GetMapping("/api/reports")
    fun reports(
        request: HttpServletRequest,
        @RequestParam(required = false) start: String?,
        @RequestParam(required = false) end: String?,
    ): Any {
        val store = repo.read(request.userId())
        return StoreLogic.buildReports(store, start?.take(10), end?.take(10))
    }

    @GetMapping("/api/health")
    fun health(): Any {
        val database = linkedMapOf<String, Any?>("ok" to false, "valid" to true)
        try {
            jdbc.execute("SELECT 1")
            database["ok"] = true
            database["driver"] = "postgresql"
        } catch (e: Exception) {
            database["error"] = e.message
        }
        return newDoc(
            "ok" to (database["ok"] == true),
            "dataSource" to "PostgreSQL (kotlin microservices)",
            "database" to database,
            "metalRates" to newDoc("configured" to true, "provider" to (System.getenv("METAL_PRICE_PROVIDER") ?: "gold-api"), "ok" to true),
        )
    }

    @GetMapping("/api/healthz")
    fun healthz(): Any = mapOf("ok" to true)
}
