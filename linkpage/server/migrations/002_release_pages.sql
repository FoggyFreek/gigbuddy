-- Release landing pages: a band can publish, next to its main link page, one
-- page per song/album launch ("smart link" style). `page_type` separates the
-- two; `release` holds a small snapshot ({songId, title, artist}) so the page
-- header survives the song later being renamed or deleted in GigBuddy.
ALTER TABLE pages
  ADD COLUMN page_type TEXT NOT NULL DEFAULT 'main' CHECK (page_type IN ('main', 'release')),
  ADD COLUMN release JSONB;

CREATE INDEX pages_tenant_idx ON pages (gigbuddy_tenant_id);

-- Outbound click events for conversion statistics: same coarse anonymous
-- dimensions as page_views (see PRIVACY.md) plus `target` — the platform or
-- widget label that was clicked (e.g. 'spotify', 'apple', 'shop'). Never a
-- URL, never anything visitor-derived beyond the shared dimensions.
CREATE TABLE page_clicks (
  id            BIGSERIAL PRIMARY KEY,
  page_id       INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  target        TEXT NOT NULL,
  device        TEXT NOT NULL,
  source        TEXT NOT NULL,
  country       TEXT NOT NULL,
  visitor_hash  TEXT
);

CREATE INDEX page_clicks_page_time_idx ON page_clicks (page_id, occurred_at DESC);
