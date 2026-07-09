-- Dashboard "memory" tile: an optional celebratory photo the band shows on the
-- overview, with a free-text caption and an optional reference to a past gig.
-- This is customization data (gated by the customization feature) and is nulled
-- by the downgrade purge alongside the banner/avatar.
--
-- memory_gig_id is a plain FK to gigs(id): referential integrity + auto-clear
-- when the referenced gig is deleted. Tenant isolation (the gig must belong to
-- THIS tenant) is enforced in the service layer on write, matching the app's
-- WHERE-tenant_id primary defense.
ALTER TABLE tenants
  ADD COLUMN memory_image_path TEXT,
  ADD COLUMN memory_caption    TEXT,
  ADD COLUMN memory_gig_id     INTEGER REFERENCES gigs(id) ON DELETE SET NULL;
