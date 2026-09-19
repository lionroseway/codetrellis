-- Billing schema, owned by services/billing (Go).
-- The line below is a comment: it must never become a table reference.
-- SELECT * FROM ghost_table
CREATE TABLE invoices (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_order ON invoices(order_id);
