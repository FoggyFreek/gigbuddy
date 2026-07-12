-- Durable bridge between remote Mollie-link deactivation and the local,
-- atomic bank-statement reconciliation transaction.
CREATE TABLE bank_mollie_reconciliation_operations (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bank_statement_line_id INTEGER NOT NULL,
  invoice_id INTEGER NOT NULL,
  mollie_payment_link_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'deactivation_pending'
    CHECK (status IN (
      'deactivation_pending', 'deactivated', 'completed',
      'mollie_paid', 'retryable_error', 'conflict'
    )),
  last_error_code TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, bank_statement_line_id),
  UNIQUE (id, tenant_id),
  CONSTRAINT bank_mollie_operation_line_fkey
    FOREIGN KEY (bank_statement_line_id, tenant_id)
    REFERENCES bank_statement_lines(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT bank_mollie_operation_invoice_fkey
    FOREIGN KEY (invoice_id, tenant_id)
    REFERENCES invoices(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX bank_mollie_operation_invoice_idx
  ON bank_mollie_reconciliation_operations (tenant_id, invoice_id);

-- One invoice/link may only be under active bank reconciliation once. Terminal
-- rows remain as audit history and no longer reserve the invoice.
CREATE UNIQUE INDEX bank_mollie_operation_active_invoice_key
  ON bank_mollie_reconciliation_operations (tenant_id, invoice_id)
  WHERE status IN ('deactivation_pending', 'deactivated', 'retryable_error');
