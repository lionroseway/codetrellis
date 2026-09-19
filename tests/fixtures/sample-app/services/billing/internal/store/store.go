// Package store persists ledger entries.
package store

import "errors"

// ErrNotFound is returned when an entry is missing.
var ErrNotFound = errors.New("not found")

// Save writes entries. The fixture keeps it in memory.
func Save(entries interface{}) error {
	return nil
}

// Load reads entries back.
func Load(id string) (interface{}, error) {
	return nil, ErrNotFound
}

// --- Raw SQL, used by the Phase 21 ref-tracker fixture -----------------
//
// Never executed; the fixture store is in memory. They exist so the SQL
// ref-tracker has realistic embedded queries to find, against the tables
// declared in db/migrations/.

const listInvoicesSQL = `
	SELECT i.id, i.order_id, i.total
	FROM invoices i
	WHERE i.order_id = $1
`

const insertPaymentSQL = `INSERT INTO payments (invoice_id, amount) VALUES ($1, $2)`

// legacy_notes is created in 003 and dropped in 031, so this query must
// NOT produce an edge — there is nothing left for it to point at.
const legacyNotesSQL = `SELECT body FROM legacy_notes WHERE id = $1`

// ListInvoices reads invoices for an order.
func ListInvoices(db Queryer, orderID int) error {
	_, err := db.Query(listInvoicesSQL, orderID)
	return err
}

// RecordPayment writes a payment row.
func RecordPayment(db Queryer, invoiceID, amount int) error {
	_, err := db.Query(insertPaymentSQL, invoiceID, amount)
	return err
}

// Queryer is the minimal database surface the fixture needs.
type Queryer interface {
	Query(query string, args ...interface{}) (interface{}, error)
}
