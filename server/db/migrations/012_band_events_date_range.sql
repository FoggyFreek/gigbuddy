ALTER TABLE band_events
  ADD COLUMN start_date DATE,
  ADD COLUMN end_date   DATE;

UPDATE band_events SET start_date = event_date, end_date = event_date;

ALTER TABLE band_events
  ALTER COLUMN start_date SET NOT NULL,
  ALTER COLUMN end_date   SET NOT NULL,
  DROP COLUMN event_date,
  ADD CONSTRAINT band_events_date_range_check CHECK (end_date >= start_date);

DROP INDEX IF EXISTS band_events_event_date_idx;
CREATE INDEX band_events_start_date_idx ON band_events(start_date);
