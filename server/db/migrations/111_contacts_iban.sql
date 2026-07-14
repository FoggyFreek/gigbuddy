-- Supplier (contacts) IBAN, so a bank-statement importer can match a statement
-- line's counterparty to an existing supplier by account number.
--
-- Deliberately NOT unique: two suppliers can legitimately share an IBAN edge
-- case (e.g. a payment platform), so multiple matches are treated as *ambiguous*
-- at match time and surfaced as a choice — never auto-picked or upserted.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS iban TEXT;

CREATE INDEX IF NOT EXISTS contacts_tenant_iban_idx
  ON contacts (tenant_id, iban) WHERE iban IS NOT NULL;
