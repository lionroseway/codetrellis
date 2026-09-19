import Foundation

public final class Invoice: Poster {
    public private(set) var total: Decimal
    public let status: InvoiceStatus

    public init(seed: Decimal, status: InvoiceStatus = .open) {
        self.total = seed
        self.status = status
    }

    deinit {
        total = 0
    }

    public func post(amount: Decimal) {
        total += amount
    }

    public static func empty() -> Invoice {
        Invoice(seed: 0)
    }
}

extension Invoice: CustomStringConvertible {
    public var description: String {
        "Invoice(\(total))"
    }

    func summary() -> String {
        description
    }
}
