-- Refunds against subscription payments.
--
-- Two sources, one table: the self-service withdrawal window (cancelling within
-- five days of the charge that opened the period refunds it in full) and a
-- super-admin partial refund for support cases handled out of band.
--
-- The row is the durable INTENT, committed before the provider call, so a crash
-- mid-refund is resumable rather than lost money. The provider remains the
-- authority on whether the money actually moved, which is why `status` tracks
-- the call rather than assuming it succeeded.

CREATE TABLE subscription_refunds (
  id                      SERIAL PRIMARY KEY,
  subscription_id         INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  subscription_payment_id INTEGER NOT NULL REFERENCES subscription_payments(id) ON DELETE CASCADE,
  amount_cents            INTEGER NOT NULL CHECK (amount_cents > 0),
  reason                  TEXT NOT NULL CHECK (reason IN ('withdrawal_window','admin_grant')),
  note                    TEXT,
  -- NULL = the customer's own withdrawal; set = the super admin who granted it.
  requested_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','succeeded','failed')),
  mollie_refund_id        TEXT UNIQUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX subscription_refunds_subscription_idx
  ON subscription_refunds (subscription_id);
-- The "already refunded ≤ payment amount" rule is a SUM, which no constraint can
-- express; the service enforces it under a lock on the payment row, and this
-- index is what makes that sum cheap.
CREATE INDEX subscription_refunds_payment_idx
  ON subscription_refunds (subscription_payment_id) WHERE status <> 'failed';
