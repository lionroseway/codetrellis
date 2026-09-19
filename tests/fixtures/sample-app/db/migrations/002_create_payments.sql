CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    amount INTEGER NOT NULL
);
