-- Platform-level subscription state. A subscription belongs to a USER (the
-- billing owner); tenants inherit entitlements from their owner's subscription
-- (migration 102 adds tenants.owner_user_id). Billing flows (Mollie) land in a
-- later phase — this migration lays down the full schema so the entitlement
-- resolver can be built and tested now.

CREATE TABLE subscriptions (
  id                        SERIAL PRIMARY KEY,
  user_id                   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                   INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status                    TEXT NOT NULL CHECK (status IN
    ('pending_mandate','pending_activation','trialing','active','past_due','canceled')),
  billing_interval          TEXT CHECK (billing_interval IN ('month','year')),
  -- Price snapshot at subscribe/change time — plan price edits never affect
  -- running subscriptions. 0 for complimentary/fallback situations.
  price_cents               INTEGER NOT NULL CHECK (price_cents >= 0),
  cancel_at_period_end      BOOLEAN NOT NULL DEFAULT FALSE,
  current_period_start      TIMESTAMPTZ,
  current_period_end        TIMESTAMPTZ,
  trial_ends_at             TIMESTAMPTZ,
  past_due_since            TIMESTAMPTZ,
  trial_reminder_sent_at    TIMESTAMPTZ,
  -- Per-subscription entitlement overrides, merged over the plan's
  -- entitlements (shared/entitlements.js mergeEntitlements).
  entitlement_overrides     JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_complimentary          BOOLEAN NOT NULL DEFAULT FALSE,
  complimentary_expires_at  TIMESTAMPTZ,
  -- Plan-change saga markers: local activation happens first; these flag that
  -- the remote Mollie schedule still needs repair (see the billing phase).
  mollie_schedule_stale     BOOLEAN NOT NULL DEFAULT FALSE,
  billing_repair_needed     BOOLEAN NOT NULL DEFAULT FALSE,
  mollie_mandate_id         TEXT,
  mollie_subscription_id    TEXT,
  mollie_first_payment_id   TEXT,
  -- Pending plan change (upgrade/interval switch, or paid downgrade).
  pending_plan_id           INTEGER REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  pending_change_kind       TEXT CHECK (pending_change_kind IN ('upgrade','downgrade','interval')),
  pending_billing_interval  TEXT CHECK (pending_billing_interval IN ('month','year')),
  pending_price_cents       INTEGER CHECK (pending_price_cents >= 0),
  pending_payment_id        TEXT,
  -- Downgrade bookkeeping: the purge manifest and target-limit snapshot are
  -- frozen at confirmation. The snapshot binds capacity growth immediately
  -- (resolver uses min(current, snapshot)); the manifest executes only once
  -- the target plan is actually active.
  pending_purge_manifest    JSONB,
  pending_limits_snapshot   JSONB,
  downgrade_confirmed_at    TIMESTAMPTZ,
  cancel_reason             TEXT CHECK (cancel_reason IN
    ('user_requested','payment_failed','trial_abandoned','superseded','admin_revoked')),
  canceled_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A pending change is set and cleared as one unit.
  CONSTRAINT subscriptions_pending_all_or_none CHECK (
    (pending_plan_id IS NULL AND pending_change_kind IS NULL
      AND pending_billing_interval IS NULL AND pending_price_cents IS NULL)
    OR (pending_plan_id IS NOT NULL AND pending_change_kind IS NOT NULL
      AND pending_billing_interval IS NOT NULL AND pending_price_cents IS NOT NULL)
  ),
  -- Downgrade-to-fallback rides the cancel path (no replacement subscription),
  -- so cancel-at-period-end and a pending plan change never coexist. The purge
  -- manifest/limits snapshot MAY accompany cancel — that IS the fallback
  -- downgrade.
  CONSTRAINT subscriptions_cancel_xor_pending CHECK (
    NOT (cancel_at_period_end AND pending_plan_id IS NOT NULL)
  )
);

-- One live (non-canceled) subscription per user.
CREATE UNIQUE INDEX subscriptions_one_live_per_user_idx
  ON subscriptions (user_id) WHERE status <> 'canceled';
CREATE INDEX subscriptions_plan_id_idx ON subscriptions (plan_id);
CREATE INDEX subscriptions_pending_plan_id_idx ON subscriptions (pending_plan_id)
  WHERE pending_plan_id IS NOT NULL;

-- Local mirror of Mollie payments tied to a subscription. mollie_payment_id
-- is UNIQUE so webhook/reconcile ingestion can upsert race-free.
CREATE TABLE subscription_payments (
  id                SERIAL PRIMARY KEY,
  subscription_id   INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  mollie_payment_id TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL CHECK (kind IN ('mandate_verification','recurring','plan_change')),
  amount_cents      INTEGER NOT NULL,
  status            TEXT NOT NULL,
  paid_at           TIMESTAMPTZ,
  mollie_created_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX subscription_payments_subscription_idx
  ON subscription_payments (subscription_id);

-- Outbox for remote Mollie calls: a row is committed BEFORE every remote call
-- so a crash mid-saga is recoverable (scheduler adopts or retries).
CREATE TABLE billing_operations (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id    INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE,
  op_type            TEXT NOT NULL,
  idempotency_key    TEXT NOT NULL UNIQUE,
  mollie_resource_id TEXT,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','succeeded','failed_retryable','failed_terminal')),
  last_error_code    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX billing_operations_subscription_idx ON billing_operations (subscription_id);

-- Deferred S3 deletions (purges, orphaned uploads). Drained by the billing
-- scheduler; release_reservation marks rows whose storage reservation must be
-- decremented once the object is confirmed gone.
CREATE TABLE storage_cleanup_queue (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_key          TEXT NOT NULL UNIQUE,
  release_reservation BOOLEAN NOT NULL DEFAULT FALSE,
  enqueued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts            INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE users ADD COLUMN mollie_customer_id TEXT;
