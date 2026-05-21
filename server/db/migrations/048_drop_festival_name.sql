-- Backfill: preserve festival display names into the canonical name column
UPDATE venues
   SET name = NULLIF(festival_name, '')
 WHERE category = 'festival'
   AND NULLIF(festival_name, '') IS NOT NULL;

ALTER TABLE venues DROP COLUMN festival_name;
