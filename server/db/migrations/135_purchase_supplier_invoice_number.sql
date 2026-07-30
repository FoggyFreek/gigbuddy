-- The supplier's OWN invoice number (EN 16931 BT-1), as distinct from
-- receipt_number, which is our per-tenant sequential id for the same bill.
--
-- Until now an imported e-invoice put this in `memo`, which made it invisible
-- to any query: the number you quote when paying, and the only reliable way to
-- tell "this bill again" from "another bill of the same amount on the same day",
-- was free text.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS supplier_invoice_number TEXT;

-- One bill per supplier per number — the constraint that makes double entry
-- impossible rather than merely warned about, for the import path and for hand
-- entry alike.
--
-- The supplier key is the linked contact when there is one, and the lower-cased
-- free-text name otherwise, so a bill from an unlinked supplier is still
-- covered. Partial: every existing row has NULL here and is left alone, and a
-- purchase with no supplier number stays unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS purchases_tenant_supplier_invoice_number_key
  ON purchases (
    tenant_id,
    COALESCE(supplier_contact_id::text, lower(supplier_name)),
    supplier_invoice_number
  )
  WHERE supplier_invoice_number IS NOT NULL;
