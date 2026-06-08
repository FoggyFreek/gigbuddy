-- Purchases: incoming supplier expenses. Mirrors the invoices model (046) but
-- simpler: per-line amounts are entered Incl. VAT and the net/VAT split is
-- derived. Suppliers are contacts (new 'supplier' category). See plan:
-- C:\Users\joris\.claude\plans\plan-to-add-purchases-fancy-balloon.md

-- Widen the contacts category enum so suppliers can be real contacts.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_category_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_category_check
  CHECK (category IN ('press', 'radio & tv', 'booker', 'promotion', 'network', 'supplier'));

CREATE TABLE purchases (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Plain per-tenant sequential integer (auto-assigned, editable while draft).
  receipt_number INTEGER NOT NULL,

  supplier_name TEXT NOT NULL,
  supplier_contact_id INTEGER,

  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  currency TEXT NOT NULL DEFAULT 'EUR',
  memo TEXT,

  -- Authoritative totals (integer cents). subtotal = net (excl. VAT).
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid')),
  finalized_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT purchases_id_tenant_id_key UNIQUE (id, tenant_id),
  CONSTRAINT purchases_tenant_receipt_number_key UNIQUE (tenant_id, receipt_number),
  -- Composite FK with explicit column list on SET NULL: only supplier_contact_id
  -- is nullified, tenant_id stays (it is NOT NULL). Mirrors invoices.gig_id.
  CONSTRAINT purchases_supplier_contact_id_tenant_id_fkey
    FOREIGN KEY (supplier_contact_id, tenant_id) REFERENCES contacts(id, tenant_id)
    ON DELETE SET NULL (supplier_contact_id)
);

CREATE INDEX purchases_tenant_receipt_idx ON purchases(tenant_id, receipt_date DESC);
CREATE INDEX purchases_supplier_contact_id_idx ON purchases(supplier_contact_id);

CREATE TABLE purchase_lines (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  expense_category TEXT,
  tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 21.00,
  amount_incl_cents INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT purchase_lines_purchase_id_tenant_id_fkey
    FOREIGN KEY (purchase_id, tenant_id) REFERENCES purchases(id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX purchase_lines_purchase_idx ON purchase_lines(purchase_id);

-- Per-tenant monotonic counter for receipt numbers. Atomic UPSERT avoids the
-- MAX(receipt_number) race inside a transaction.
CREATE TABLE purchase_number_sequences (
  tenant_id INTEGER NOT NULL PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  next_seq INTEGER NOT NULL DEFAULT 1
);
