import Foundation
import BillingCore
import struct BillingCore.Money

struct App {
    let invoice: Invoice

    func run() {
        invoice.post(amount: Money(amount: 10, currency: "GBP").amount)
    }
}

func bootstrap() -> App {
    App(invoice: Invoice.empty())
}

bootstrap().run()

/// Calls the Kotlin scheduler — the mobile client is the far end of a
/// chain that runs Swift → Kotlin → C# → Python.
struct SchedulerClient {
    func jobs() async throws -> Data {
        let url = URL(string: "http://scheduler.internal/api/jobs")!
        return try await URLSession.shared.data(from: url).0
    }

    func cancel(id: String) async throws {
        let url = URL(string: "http://scheduler.internal/api/jobs/\(id)")!
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        _ = try await URLSession.shared.data(for: request)
    }
}
