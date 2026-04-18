CREATE TABLE band_members (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE availability_slots (
  id              SERIAL PRIMARY KEY,
  band_member_id  INTEGER REFERENCES band_members(id) ON DELETE CASCADE,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('available', 'unavailable')),
  reason          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX idx_avail_member ON availability_slots(band_member_id);
CREATE INDEX idx_avail_range  ON availability_slots(start_date, end_date);
