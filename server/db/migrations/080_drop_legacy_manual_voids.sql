-- One-time cleanup of the legacy manual "void" operation (feature-ledger).
--
-- Before the open/closed correction split, voiding a ledger entry posted a
-- reversing `ledger_transaction/void` transaction that cancelled the original
-- mathematically. Migration 079 then backfilled a `voided_at` marker onto those
-- originals. Those reversing transactions are now redundant, and the books they
-- touch are still open, so we unwind the legacy state entirely: the originals
-- return to a normal, un-voided state and will be re-voided through the new UI.
--
-- This is intentionally NOT scoped to "before a date": at deploy time every
-- `ledger_transaction/void` row is a legacy artifact. New voids created after
-- this migration are unaffected (the migration runs once).
--
-- Financially a no-op: a voided original and its reverser are both excluded from
-- reports today, so removing the pair and clearing the marker leaves every
-- balance unchanged until the entries are re-voided.

-- Step 1 — un-void the originals (clear the markers 079 set). Must run before
-- the DELETE: voided_by_transaction_id has a FK onto the rows we're deleting.
UPDATE ledger_transactions orig
   SET voided_at = NULL,
       voided_by_transaction_id = NULL
  FROM ledger_transactions rev
 WHERE rev.id = orig.voided_by_transaction_id
   AND rev.tenant_id = orig.tenant_id
   AND rev.source_type = 'ledger_transaction'
   AND rev.source_event = 'void';

-- Step 2 — delete the legacy void reversing transactions. Their ledger_entries
-- are removed by the ON DELETE CASCADE FK on ledger_entries.transaction_id.
DELETE FROM ledger_transactions
 WHERE source_type = 'ledger_transaction'
   AND source_event = 'void';
