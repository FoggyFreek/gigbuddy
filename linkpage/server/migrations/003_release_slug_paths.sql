-- Move release pages from the flat `<mainSlug>-<tail>` slug into the namespaced
-- `<mainSlug>/<tail>` form so release and main slugs can never share a key (a
-- main slug can't contain '/'). Each release's main slug is its own tenant's
-- main page slug. Guarded by `position('/' in slug) = 0` so it is a no-op on
-- rows already migrated (and on any future re-run).
UPDATE pages r
   SET slug = m.slug || '/' || substring(r.slug FROM length(m.slug) + 2),
       updated_at = NOW()
  FROM pages m
 WHERE r.page_type = 'release'
   AND m.page_type = 'main'
   AND m.gigbuddy_tenant_id = r.gigbuddy_tenant_id
   AND r.slug LIKE m.slug || '-%'
   AND position('/' in r.slug) = 0;
