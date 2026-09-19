CREATE MATERIALIZED VIEW invoice_totals AS
SELECT order_id, sum(total) AS lifetime_total
FROM invoices
GROUP BY order_id;
