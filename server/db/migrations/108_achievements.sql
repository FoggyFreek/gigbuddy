-- Permanent per-tenant achievement unlocks. Rows are only ever inserted
-- (unlocks are never revoked); achievement_key matches a key in
-- server/achievements/definitions.js and must never be renamed after ship.
CREATE TABLE tenant_achievements (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, achievement_key)
);

CREATE INDEX tenant_achievements_tenant_unlocked_idx
  ON tenant_achievements (tenant_id, unlocked_at DESC);
