-- Per-user iCalendar feed tokens. Each row is a secret bearer token that lets an
-- external calendar app (Google/Apple/Outlook) poll a read-only .ics feed of the
-- tenant calendar without a session/OIDC/CSRF. The token is bound to the tenant
-- that was active when it was created; one feed per (user, tenant). Rotating
-- regenerates the token in place (ON CONFLICT), invalidating the old URL.
CREATE TABLE ical_feed_tokens (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token            TEXT NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  UNIQUE (user_id, tenant_id)
);
