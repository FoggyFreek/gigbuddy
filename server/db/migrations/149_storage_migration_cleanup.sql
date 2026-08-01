DROP TABLE IF EXISTS storage_migration_objects;
DROP TABLE IF EXISTS storage_migrations;

DROP INDEX IF EXISTS storage_cleanup_queue_key_store_idx;

UPDATE storage_cleanup_queue queue
SET release_reservation = grouped.release_reservation,
    attempts = grouped.attempts
FROM (
  SELECT object_key,
         BOOL_OR(release_reservation) AS release_reservation,
         MAX(attempts) AS attempts
  FROM storage_cleanup_queue
  GROUP BY object_key
) grouped
WHERE queue.object_key = grouped.object_key;

DELETE FROM storage_cleanup_queue current_row
USING storage_cleanup_queue earlier_row
WHERE current_row.object_key = earlier_row.object_key
  AND current_row.id > earlier_row.id;

ALTER TABLE storage_cleanup_queue
  DROP COLUMN IF EXISTS store_target;

ALTER TABLE storage_cleanup_queue
  DROP CONSTRAINT IF EXISTS storage_cleanup_queue_object_key_key;

ALTER TABLE storage_cleanup_queue
  ADD CONSTRAINT storage_cleanup_queue_object_key_key UNIQUE (object_key);
