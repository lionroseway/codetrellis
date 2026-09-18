package com.acme.scheduler

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.server.application.Application
import io.ktor.server.routing.routing

/**
 * Serves /api/jobs via Ktor's nested routing DSL, and calls the .NET
 * reporting service — a cross-language edge in the other direction.
 */
fun Application.configureRouting() {
    routing {
        route("/api") {
            get("/jobs") { }
            post("/jobs") { }
            route("/jobs") {
                delete("/{id}") { }
            }
        }
    }
}

class ReportingClient(private val client: HttpClient) {
    suspend fun ledger() = client.get("http://reporting.internal/api/ledger")
}
