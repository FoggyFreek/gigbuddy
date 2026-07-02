-- In-app notifications, stored per user.
--
-- DELIBERATE SCOPING EXCEPTION: notification rows are user-scoped and
-- cross-tenant — the bell aggregates all of a user's bands. Rows still carry
-- tenant_id, are only ever created by approved-membership fan-out, and every
-- read/write is scoped WHERE user_id = <caller>. Cross-user access surfaces
-- as 404, never 403.
CREATE TABLE notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL,
  source_type TEXT,
  source_id   INTEGER,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
-- Rides the throttled global 90-day retention sweep.
CREATE INDEX notifications_created_idx ON notifications (created_at);

-- Preference tables: absence of a row = enabled, so new users and newly
-- introduced notification types need no backfill.
CREATE TABLE notification_type_prefs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type    TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, type)
);

CREATE TABLE notification_tenant_prefs (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enabled   BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, tenant_id)
);
