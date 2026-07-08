-- Billing notifications are user-level, not tenant-scoped (a subscription
-- belongs to a user, and the owner may act on billing outside any active
-- tenant). Two changes support them:
--
--  1. tenant_id becomes nullable — a billing notification has no tenant.
--  2. dedupe_key + a partial UNIQUE index give transactional dispatch an
--     idempotency handle: the in-app row is inserted INSIDE the caller's state
--     transaction with ON CONFLICT (dedupe_key) DO NOTHING, so a committed
--     billing transition never loses (or duplicates) its notification even
--     across webhook/reconcile replays. Keys look like
--     billing-renewed:<subId>:<periodStart>.
ALTER TABLE notifications ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;

CREATE UNIQUE INDEX notifications_dedupe_key_idx
  ON notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;
