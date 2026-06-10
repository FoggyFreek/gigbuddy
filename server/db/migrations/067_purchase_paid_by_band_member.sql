-- Member-paid purchases should be attributable to a band member profile, even
-- when that profile is not linked to a login user.

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS paid_by_band_member_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchases_paid_by_band_member_id_tenant_id_fkey'
  ) THEN
    ALTER TABLE purchases
      ADD CONSTRAINT purchases_paid_by_band_member_id_tenant_id_fkey
      FOREIGN KEY (paid_by_band_member_id, tenant_id)
      REFERENCES band_members(id, tenant_id)
      ON DELETE SET NULL (paid_by_band_member_id);
  END IF;
END $$;
