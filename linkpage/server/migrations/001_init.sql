-- One row per band link page. `content` is the denormalized snapshot synced
-- from GigBuddy (band profile, songs, products, gigs); `draft_layout` /
-- `published_layout` are the editor-arranged widget stacks referencing that
-- content by id. gigbuddy_tenant_id ties the page to its band but carries no
-- FK — the databases are separate by design.
CREATE TABLE pages (
  id                  SERIAL PRIMARY KEY,
  slug                TEXT UNIQUE NOT NULL,
  gigbuddy_tenant_id  INTEGER NOT NULL,
  draft_layout        JSONB NOT NULL DEFAULT '{"sections": []}',
  published_layout    JSONB,
  content             JSONB NOT NULL DEFAULT '{}',
  content_synced_at   TIMESTAMPTZ,
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Visit statistics: one row per public page view, containing ONLY coarse,
-- anonymous dimensions (see PRIVACY.md). No IP addresses, no user agents,
-- no cookies. visitor_hash is a truncated daily-rotating keyed hash used
-- solely to estimate unique visitors within a day; it cannot be linked
-- across days or reversed to an identity.
CREATE TABLE page_views (
  id            BIGSERIAL PRIMARY KEY,
  page_id       INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  device        TEXT NOT NULL,
  source        TEXT NOT NULL,
  country       TEXT NOT NULL,
  visitor_hash  TEXT
);

CREATE INDEX page_views_page_time_idx ON page_views (page_id, occurred_at DESC);
