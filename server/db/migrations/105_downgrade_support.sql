-- Phase 6 downgrade support.
--
-- tenants.mollie_api_key_retained_at — set when the integrations purge finds
-- paid payment links that still need webhook/sync access: the key value stays
-- stored but the public credential status reports it absent; only the internal
-- payment-link webhook/sync accessor may still decrypt it. Storing a new key
-- (or clearing it) nulls the marker.
--
-- subscriptions.pending_activation_at — stamped whenever a row ENTERS
-- pending_activation (mandate flip or paid-downgrade period-end flip), so the
-- stale-activation scheduler ages from the flip, not from created_at.
--
-- subscriptions.downgrade_schedule_pending — durable "cancel the old provider
-- subscription + create the lower-amount replacement" marker; the saga clears
-- it atomically with the repoint, the scheduler resumes it after a crash.
--
-- subscriptions.superseded_mollie_subscription_id — the OLD provider
-- subscription id captured at downgrade confirmation, so a resumed saga always
-- cancels the old subscription and never the replacement, even after
-- mollie_subscription_id has been repointed.

ALTER TABLE tenants       ADD COLUMN mollie_api_key_retained_at        TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN pending_activation_at             TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN downgrade_schedule_pending        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE subscriptions ADD COLUMN superseded_mollie_subscription_id TEXT;
