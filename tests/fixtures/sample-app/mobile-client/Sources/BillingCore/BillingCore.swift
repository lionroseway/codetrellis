import Foundation

public protocol Poster {
    func post(amount: Decimal)
}

public struct Money: Codable, Equatable {
    public let amount: Decimal
    public let currency: String

    public init(amount: Decimal, currency: String) {
        self.amount = amount
        self.currency = currency
    }

    public func doubled() -> Money {
        Money(amount: amount * 2, currency: currency)
    }
}

public enum InvoiceStatus: String, Codable {
    case open, closed, void
}

public typealias Cents = Int
