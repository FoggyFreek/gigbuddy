ALTER TABLE profile ADD COLUMN logo_path TEXT;

CREATE TABLE share_photos (
  id           SERIAL PRIMARY KEY,
  object_key   TEXT        NOT NULL,
  content_type TEXT        NOT NULL,
  label        TEXT        NOT NULL DEFAULT '',
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
