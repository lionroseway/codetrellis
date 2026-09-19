// Package money holds the shared value type used across fixture services.
package money

import "fmt"

// Currency is an ISO-4217 code.
type Currency string

// Amount is a minor-unit monetary value.
type Amount struct {
	Minor    int64
	Currency Currency
}

// String renders the amount for logs.
func (a Amount) String() string {
	return fmt.Sprintf("%d %s", a.Minor, a.Currency)
}

// Add returns the sum of two amounts.
func (a Amount) Add(b Amount) Amount {
	return Amount{Minor: a.Minor + b.Minor, Currency: a.Currency}
}

func normalise(minor int64) int64 { return minor }
