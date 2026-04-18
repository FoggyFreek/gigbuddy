CREATE TABLE profile (
  id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  band_name         TEXT,
  bio               TEXT,
  instagram_handle  TEXT,
  facebook_handle   TEXT,
  tiktok_handle     TEXT,
  youtube_handle    TEXT,
  spotify_handle    TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE profile_links (
  id         SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL DEFAULT 1 REFERENCES profile(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  url        TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profile_links_profile_id ON profile_links(profile_id);

INSERT INTO profile (id) VALUES (1) ON CONFLICT DO NOTHING;
