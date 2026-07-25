-- Backfill the correction markers for invoice voids posted before
-- postInvoiceVoid started setting them.
--
-- Voiding a sent invoice posts a compensating journal (invoice/void). Only that
-- compensating row was recognised as voided, so the ledger browser hid it while
-- the original invoice/sent journal stayed in the default list — half a void.
-- Mark both halves, exactly as the posting path now does:
--
--   * original in an open period → VOID: mark the original voided_at /
--     voided_by_transaction_id and give the compensating journal its own
--     voided_at, so both hide from the default list and both drop out of the
--     financial aggregations (the pair still nets to zero).
--   * original in a closed period → REVERSAL: never touch the closed period.
--     Only record reversed_by_transaction_id on the original; both rows stay
--     visible and stay in reports, netting the mistake out forward.
--
-- Idempotent: every statement skips rows that already carry a marker.
-- Historical closed-period corrections keep their 'void' source_event (it is
-- part of the posting idempotency key and must not be rewritten); new ones post
-- as 'reversal'.

-- 1. Open-period originals: void them, pointing at the compensating journal.
UPDATE ledger_transactions orig
   SET voided_at = comp.created_at,
       voided_by_transaction_id = comp.id
  FROM ledger_transactions comp
  LEFT JOIN tenant_accounting_settings tas
    ON tas.tenant_id = comp.tenant_id
 WHERE comp.tenant_id = orig.tenant_id
   AND comp.source_type = 'invoice'
   AND comp.source_event = 'void'
   AND comp.source_id = orig.source_id
   AND orig.source_type = 'invoice'
   AND orig.source_event = 'sent'
   AND orig.voided_at IS NULL
   AND orig.reversed_by_transaction_id IS NULL
   AND (tas.books_closed_through IS NULL OR orig.entry_date > tas.books_closed_through);

-- 2. The compensating journals of those voids: mark them voided too, so a
--    report never picks up one half of the pair without the other.
UPDATE ledger_transactions comp
   SET voided_at = comp.created_at
  FROM ledger_transactions orig
 WHERE orig.tenant_id = comp.tenant_id
   AND orig.voided_by_transaction_id = comp.id
   AND orig.source_type = 'invoice'
   AND orig.source_event = 'sent'
   AND comp.source_type = 'invoice'
   AND comp.source_event = 'void'
   AND comp.voided_at IS NULL;

-- 3. Closed-period originals: record the reversal link only — the closed period
--    keeps its figures and both rows stay visible.
UPDATE ledger_transactions orig
   SET reversed_by_transaction_id = comp.id
  FROM ledger_transactions comp
  JOIN tenant_accounting_settings tas
    ON tas.tenant_id = comp.tenant_id
 WHERE comp.tenant_id = orig.tenant_id
   AND comp.source_type = 'invoice'
   AND comp.source_event = 'void'
   AND comp.source_id = orig.source_id
   AND orig.source_type = 'invoice'
   AND orig.source_event = 'sent'
   AND orig.voided_at IS NULL
   AND orig.reversed_by_transaction_id IS NULL
   AND tas.books_closed_through IS NOT NULL
   AND orig.entry_date <= tas.books_closed_through;
