-- Phase 4: scope venue/contact uniqueness to the owning tenant. Two tenants
-- can each have a venue named "The Garage" without colliding.

DROP INDEX IF EXISTS venues_name_city_uidx;
CREATE UNIQUE INDEX venues_tenant_name_city_uidx
  ON venues (tenant_id, lower(name), lower(coalesce(city, '')));

DROP INDEX IF EXISTS contacts_name_category_uidx;
CREATE UNIQUE INDEX contacts_tenant_name_category_uidx
  ON contacts (tenant_id, lower(name), lower(category));
