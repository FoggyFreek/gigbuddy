ALTER TABLE gigs ADD COLUMN end_date DATE;
ALTER TABLE rehearsals ADD COLUMN end_date DATE;

-- Drop the old same-day-only constraints before the UPDATEs below: Postgres
-- re-checks every CHECK constraint on a row when it's updated, regardless of
-- which columns changed, so pre-existing overnight rows (end_time < start_time)
-- would otherwise violate the still-active old constraints.
ALTER TABLE gigs DROP CONSTRAINT IF EXISTS gigs_daily_time_range_check;
ALTER TABLE rehearsals DROP CONSTRAINT IF EXISTS rehearsals_daily_time_range_check;

UPDATE gigs
   SET end_date = event_date
 WHERE event_date IS NOT NULL;

UPDATE rehearsals
   SET end_date = proposed_date
 WHERE proposed_date IS NOT NULL;

ALTER TABLE gigs ADD CONSTRAINT gigs_event_time_range_check
  CHECK (
    end_date IS NULL
    OR (
      end_date = event_date
      AND (start_time IS NULL OR end_time IS NULL OR end_time > start_time)
    )
    OR (
      end_date = event_date + 1
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_time < start_time
    )
  ) NOT VALID;

ALTER TABLE rehearsals ADD CONSTRAINT rehearsals_event_time_range_check
  CHECK (
    end_date IS NULL
    OR (
      end_date = proposed_date
      AND (start_time IS NULL OR end_time IS NULL OR end_time > start_time)
    )
    OR (
      end_date = proposed_date + 1
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND end_time < start_time
    )
  ) NOT VALID;
