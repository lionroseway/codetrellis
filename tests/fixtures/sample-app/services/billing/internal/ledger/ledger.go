// Package ledger records billing entries.
package ledger

import (
	"github.com/codetrellis/fixture/billing/internal/store"
	"github.com/codetrellis/fixture/shared/money"
)

// Ledger is an append-only list of entries.
type Ledger struct {
	entries []Entry
}

// Reader reads entries back out.
type Reader interface {
	Read(id string) (Entry, error)
}

type (
	// Page is a slice of entries.
	Page []Entry
	// Cursor marks a position in the ledger.
	Cursor string
)

// MaxEntries caps an in-memory ledger.
const MaxEntries = 1000

var defaultLedger = &Ledger{}

// All returns every entry.
func All() []Entry {
	return defaultLedger.entries
}

// Post appends an entry.
func (l *Ledger) Post(amount money.Amount) error {
	l.entries = append(l.entries, Entry{Amount: amount})
	return store.Save(l.entries)
}

// Total sums the ledger.
func (l *Ledger) Total() money.Amount {
	var out money.Amount
	for _, e := range l.entries {
		out = out.Add(e.Amount)
	}
	return out
}

func reset() { defaultLedger = &Ledger{} }
