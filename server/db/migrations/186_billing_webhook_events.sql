-- Durable delivery history for the platform-billing webhook. The provider
-- endpoint deliberately always returns 200, so operational failures must be
-- recorded independently if operators are to distinguish a healthy delivery
-- from one that only appeared healthy to Mollie.

CREATE TABLE billing_webhook_events (
  id                  BIGSERIAL PRIMARY KEY,
  subscription_id     INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  provider_payment_id TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('received', 'processed', 'failed')),
  error_code          TEXT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at        TIMESTAMPTZ
);

CREATE INDEX billing_webhook_events_subscription_idx
  ON billing_webhook_events (subscription_id, received_at DESC);

CREATE INDEX billing_webhook_events_failures_idx
  ON billing_webhook_events (received_at DESC, id DESC)
  WHERE status = 'failed';
