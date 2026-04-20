CREATE TABLE band_events (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  event_date  DATE NOT NULL,
  start_time  TIME,
  end_time    TIME,
  location    TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX band_events_event_date_idx ON band_events(event_date);
