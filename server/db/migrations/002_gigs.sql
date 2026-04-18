CREATE TABLE gigs (
  id                SERIAL PRIMARY KEY,
  event_date        DATE NOT NULL,
  start_time        TIME,
  end_time          TIME,
  event_description TEXT NOT NULL,
  venue             TEXT,
  city              TEXT,
  status            TEXT NOT NULL DEFAULT 'option'
                    CHECK (status IN ('option', 'confirmed', 'announced')),
  booking_fee_cents INTEGER,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gig_tasks (
  id         SERIAL PRIMARY KEY,
  gig_id     INTEGER NOT NULL REFERENCES gigs(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  done       BOOLEAN NOT NULL DEFAULT FALSE,
  due_date   DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gig_tasks_gig_id ON gig_tasks(gig_id);
