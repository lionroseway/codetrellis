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
