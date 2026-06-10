-- Purchase reimbursements are tracked by band member profile only. A band
-- member does not need a login account to front a purchase.

ALTER TABLE purchases
  DROP COLUMN IF EXISTS paid_by_user_id;

