package ledger

import "github.com/codetrellis/fixture/shared/money"

// Entry is one ledger line.
type Entry struct {
	ID     string
	Amount money.Amount
}

// Describe renders the entry.
func (e Entry) Describe() string {
	return e.ID + " " + e.Amount.String()
}
