CREATE TABLE gig_participants (
  id                 SERIAL PRIMARY KEY,
  gig_id             INTEGER NOT NULL REFERENCES gigs(id) ON DELETE CASCADE,
  band_member_id     INTEGER NOT NULL REFERENCES band_members(id) ON DELETE CASCADE,
  vote               TEXT CHECK (vote IN ('yes', 'no')),
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gig_id, band_member_id)
);

CREATE INDEX gig_participants_gig_idx ON gig_participants(gig_id);
