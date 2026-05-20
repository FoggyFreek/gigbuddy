-- Invoices: created from a gig, frozen customer snapshot, PDF persisted to MinIO.
-- See plan: C:\Users\joris\.claude\plans\add-a-invoices-section-zippy-forest.md

CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  gig_id INTEGER,
  invoice_number TEXT NOT NULL,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  payment_term_days INTEGER NOT NULL DEFAULT 14,

  customer_name TEXT NOT NULL,
  customer_address_street TEXT,
  customer_address_postal_code TEXT,
  customer_address_city TEXT,
  customer_address_country TEXT,
  customer_email TEXT,
  customer_kvk TEXT,
  customer_tax_id TEXT,

  custom_logo_path TEXT,
  memo TEXT,
  tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  discount_cents INTEGER NOT NULL DEFAULT 0,

  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,

  pdf_path TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  finalized_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT invoices_id_tenant_id_key UNIQUE (id, tenant_id),
  CONSTRAINT invoices_tenant_invoice_number_key UNIQUE (tenant_id, invoice_number),
  -- Composite FK with explicit column list on SET NULL: only gig_id is nullified,
  -- tenant_id stays (it is NOT NULL). Mirrors the pattern in 044_gigs_venue_id.sql.
  CONSTRAINT invoices_gig_id_tenant_id_fkey
    FOREIGN KEY (gig_id, tenant_id) REFERENCES gigs(id, tenant_id)
    ON DELETE SET NULL (gig_id)
);

CREATE INDEX invoices_tenant_issue_idx ON invoices(tenant_id, issue_date DESC);
CREATE INDEX invoices_gig_id_idx ON invoices(gig_id);

CREATE TABLE invoice_lines (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  tax_percentage NUMERIC(5, 2) NOT NULL DEFAULT 9.00,

  CONSTRAINT invoice_lines_invoice_id_tenant_id_fkey
    FOREIGN KEY (invoice_id, tenant_id) REFERENCES invoices(id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX invoice_lines_invoice_idx ON invoice_lines(invoice_id);

-- Per-tenant/year monotonic counter for invoice numbers. Atomic UPSERT avoids the
-- MAX(invoice_number) race inside a transaction.
CREATE TABLE invoice_number_sequences (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  next_seq INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, year)
);
