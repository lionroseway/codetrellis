-- CodeTrellis E2E fixture: SQL schema.
-- Used by the (not-yet-implemented) SQL ref-tracker. Currently parsed
-- by nothing; committed so a fixture extension only needs to flip
-- the matcher, not add a file.

CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  amount      DECIMAL(10, 2) NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status  ON orders(status);
