-- The payment-status transition predicate, as an IMMUTABLE SQL function so the
-- rule lives INSIDE the ingestion upsert's ON CONFLICT ... WHERE clause. Keeping
-- it in the statement (never an app-side read-then-decide) is what makes webhook
-- and reconcile ingestion race-free: two concurrent upserts both evaluate the
-- guard against the committed row, so an illegal transition can never slip
-- through between a SELECT and an UPDATE.
--
-- Canonical (provider-agnostic) statuses only — adapters normalize to these
-- (see server/billing/paymentProvider/statuses.js). Graph:
--   open|pending → paid|failed|expired|canceled
--   paid         → charged_back|refunded
-- Everything else — including regressions (paid→pending) and same-status
-- rewrites — is inert: the predicate is false, DO UPDATE is skipped, and the
-- statement returns no row, so effects never re-fire.
CREATE FUNCTION billing_payment_transition_allowed(old_status text, new_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN old_status IN ('open', 'pending')
      AND new_status IN ('paid', 'failed', 'expired', 'canceled') THEN true
    WHEN old_status = 'paid'
      AND new_status IN ('charged_back', 'refunded') THEN true
    ELSE false
  END
$$;
