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
