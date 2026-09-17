-- An ALTER does not define the table: invoices stays attributed to 001.
ALTER TABLE invoices ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
