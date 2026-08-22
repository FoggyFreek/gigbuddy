-- Gig contracts are now generated directly from the gig's current terms and
-- returned to the caller. Retire stored versions and their outreach lifecycle.
INSERT INTO storage_cleanup_queue (tenant_id, object_key, release_reservation)
SELECT tenant_id, pdf_object_key, TRUE
  FROM gig_contracts
 WHERE pdf_object_key IS NOT NULL
ON CONFLICT (object_key) DO UPDATE
SET release_reservation = storage_cleanup_queue.release_reservation
                          OR EXCLUDED.release_reservation;

ALTER TABLE outreach_campaigns DROP COLUMN contract_id;
DROP TABLE gig_contracts;
