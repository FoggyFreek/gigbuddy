CREATE TABLE rehearsals (
  id                 SERIAL PRIMARY KEY,
  proposed_date      DATE NOT NULL,
  start_time         TIME,
  end_time           TIME,
  location           TEXT,
  notes              TEXT,
  status             TEXT NOT NULL DEFAULT 'option'
                       CHECK (status IN ('option', 'planned')),
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX rehearsals_proposed_date_idx ON rehearsals(proposed_date);

CREATE TABLE rehearsal_participants (
  id                 SERIAL PRIMARY KEY,
  rehearsal_id       INTEGER NOT NULL REFERENCES rehearsals(id) ON DELETE CASCADE,
  band_member_id     INTEGER NOT NULL REFERENCES band_members(id) ON DELETE CASCADE,
  vote               TEXT CHECK (vote IN ('yes', 'no')),
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rehearsal_id, band_member_id)
);

CREATE INDEX rehearsal_participants_rehearsal_idx
  ON rehearsal_participants(rehearsal_id);
