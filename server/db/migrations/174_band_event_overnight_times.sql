ALTER TABLE band_events
  DROP CONSTRAINT IF EXISTS band_events_daily_time_range_check;

ALTER TABLE band_events
  ADD CONSTRAINT band_events_daily_time_range_check
  CHECK (
    start_time IS NULL
    OR end_time IS NULL
    OR end_date > start_date
    OR end_time > start_time
  ) NOT VALID;
