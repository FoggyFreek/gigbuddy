-- Compliance & traceability (feature-ledger):
--  1. Actor audit columns: who created/approved/registered each financial record.
--     Nullable everywhere — historic rows and system postings (Mollie webhook)
--     stay NULL.
--  2. books_closed_through: per-tenant period close. Postings dated on/before it
--     are rejected (user actions) or clamped to the first open day (system
--     postings like webhook-driven cash receipts).

-- Who posted each ledger transaction (NULL = system posting, e.g. Mollie webhook).
ALTER TABLE ledger_transactions
  ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id);

ALTER TABLE journals
  ADD COLUMN IF NOT EXISTS created_by_user_id  INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS created_by_user_id            INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by_user_id           INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS payment_registered_by_user_id INTEGER REFERENCES users(id);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id);

ALTER TABLE reimbursements
  ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id);

-- Period close: nothing may be posted on or before this date (NULL = books open).
ALTER TABLE tenant_accounting_settings
  ADD COLUMN IF NOT EXISTS books_closed_through DATE;
