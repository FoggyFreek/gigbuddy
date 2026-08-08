-- Bands that are not gigbuddy customers. Migration 162 modelled these as an
-- 'ensemble' contact and 167 removed the concept again: a per-tenant address
-- book row is private to one artist, so the band itself can never find it,
-- correct it, or grow into a real tenant. This is the global, claimable
-- replacement — and, like 162's rationale, deliberately NOT a shell tenant: it
-- consumes no bands cap, has no members, and appears in no admin listing.
--
-- Claim state is DERIVED, never stored as a status column. claimed_by_tenant_id
-- plus the claim rows are the only facts, so deleting a band tenant releases the
-- profile through the foreign keys alone. A stored status would go stale there:
-- deleteTenantRow is a bare DELETE, and a CHECK tying status to the pointer
-- would turn tenant deletion into a constraint violation.

CREATE TABLE band_profiles (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),
  -- Lowercase, matching tenant_accounting_profiles.country_code.
  country_code         TEXT NOT NULL CHECK (country_code ~ '^[a-z]{2}$'),
  spotify_artist_id    TEXT CHECK (spotify_artist_id ~ '^[0-9A-Za-z]{22}$'),
  spotify_url          TEXT CHECK (length(spotify_url) <= 500),
  website_url          TEXT CHECK (length(website_url) <= 500),
  -- Normalized host + path. Advisory only (see the index note below); capped so
  -- it stays far below the btree index-entry limit.
  website_key          TEXT CHECK (length(website_key) <= 500),
  contact_email        TEXT CHECK (length(contact_email) <= 254),
  -- Who typed it in, NOT who owns it. A deleted user leaves the row standing —
  -- uneditable except by a super admin — rather than taking every artist's
  -- event link down with them.
  created_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claimed_by_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A profile with no link at all is unverifiable. The service checks this
  -- against the merged row on PATCH; this is the backstop for a partial update
  -- that clears the last one.
  CONSTRAINT band_profiles_has_link
    CHECK (spotify_url IS NOT NULL OR website_url IS NOT NULL),
  -- A dedup key without its URL (or the reverse) would silently stop matching.
  CONSTRAINT band_profiles_spotify_pair
    CHECK ((spotify_url IS NULL) = (spotify_artist_id IS NULL)),
  CONSTRAINT band_profiles_website_pair
    CHECK ((website_url IS NULL) = (website_key IS NULL))
);

-- The Spotify artist id is canonical and unambiguous, so it is the one HARD
-- dedup key.
CREATE UNIQUE INDEX band_profiles_spotify_artist_key
  ON band_profiles (spotify_artist_id) WHERE spotify_artist_id IS NOT NULL;

-- website_key is deliberately NOT unique. Normalizing a URL into a globally
-- unique identity is not safely decidable — paths are case-sensitive on many
-- servers and some query strings are the page identity rather than tracking — so
-- a wrong normalization behind a unique index would be an unrecoverable create
-- failure for a legitimate band. Here it only powers a "did you mean this one?"
-- suggestion.
CREATE INDEX idx_band_profiles_website_key
  ON band_profiles (website_key) WHERE website_key IS NOT NULL;

-- Name is not unique either: real bands share names within a country, and a
-- unique name would hand the first creator a squatting primitive over every
-- later band of that name, with no merge tool. Search is a substring ILIKE,
-- which a lower(name) btree cannot accelerate — hence trigrams.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_band_profiles_name_trgm ON band_profiles USING gin (name gin_trgm_ops);

CREATE INDEX idx_band_profiles_creator ON band_profiles (created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;
CREATE INDEX idx_band_profiles_claimed ON band_profiles (claimed_by_tenant_id)
  WHERE claimed_by_tenant_id IS NOT NULL;

-- Verification happens manually and offline; this table is the request queue.
CREATE TABLE band_profile_claims (
  id                   SERIAL PRIMARY KEY,
  -- SET NULL, not CASCADE: a decided claim is the audit record of a super
  -- admin's decision and must outlive the profile, which is deleted as soon as
  -- it has no holders left. band_profile_name is the snapshot that keeps the
  -- queue readable afterwards.
  band_profile_id      INTEGER REFERENCES band_profiles(id) ON DELETE SET NULL,
  band_profile_name    TEXT NOT NULL,
  -- CASCADE: when the claiming tenant is deleted the claim is meaningless, and
  -- its disappearance is half of what releases the profile.
  tenant_id            INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'rejected')),
  message              TEXT CHECK (length(message) <= 500),
  decided_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at           TIMESTAMPTZ,
  decision_reason      TEXT CHECK (length(decision_reason) <= 500),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT band_profile_claims_decided
    CHECK ((status = 'pending') = (decided_at IS NULL))
);

-- Backstop for the check-then-act windows the service locks against: two
-- tenants claiming the same profile, a double approval, and "one band tenant
-- claims exactly one profile" all become 23505 rather than a race. The third
-- index is also the open-claim cap — no counting, no lock. A nullable
-- band_profile_id does not weaken these: btree treats NULLs as distinct, so
-- orphaned decided rows never collide.
CREATE UNIQUE INDEX band_profile_claims_one_pending_per_profile
  ON band_profile_claims (band_profile_id) WHERE status = 'pending';
CREATE UNIQUE INDEX band_profile_claims_one_approved_per_profile
  ON band_profile_claims (band_profile_id) WHERE status = 'approved';
CREATE UNIQUE INDEX band_profile_claims_one_live_per_tenant
  ON band_profile_claims (tenant_id) WHERE status IN ('pending', 'approved');

-- The admin queue filters by status and pages through decided history, so a
-- pending-only partial index would not serve it.
CREATE INDEX idx_band_profile_claims_queue
  ON band_profile_claims (status, created_at, id);

-- The personal workspace's curated collection. Tenant-scoped like any other
-- resource; the global profile it points at is not.
CREATE TABLE my_bands (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  band_profile_id INTEGER NOT NULL REFERENCES band_profiles(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT my_bands_tenant_profile_key UNIQUE (tenant_id, band_profile_id),
  -- The parent uniqueness the event composite FKs below require.
  CONSTRAINT my_bands_id_tenant_id_key UNIQUE (id, tenant_id)
);

CREATE INDEX idx_my_bands_profile ON my_bands (band_profile_id);

-- Which band a personal-workspace event was for. Only meaningful in a personal
-- workspace: a band tenant's events are already the band's.
ALTER TABLE gigs        ADD COLUMN my_band_id INTEGER;
ALTER TABLE rehearsals  ADD COLUMN my_band_id INTEGER;
ALTER TABLE band_events ADD COLUMN my_band_id INTEGER;

-- The column list on SET NULL is load-bearing (PG 15+): without it, deleting a
-- referenced my_bands row would null EVERY column of this composite key —
-- including tenant_id, which is NOT NULL. Losing the band tag is right; losing
-- the event's tenant is a constraint violation.
ALTER TABLE gigs ADD CONSTRAINT gigs_my_band_fk
  FOREIGN KEY (my_band_id, tenant_id) REFERENCES my_bands(id, tenant_id)
  ON DELETE SET NULL (my_band_id);

ALTER TABLE rehearsals ADD CONSTRAINT rehearsals_my_band_fk
  FOREIGN KEY (my_band_id, tenant_id) REFERENCES my_bands(id, tenant_id)
  ON DELETE SET NULL (my_band_id);

ALTER TABLE band_events ADD CONSTRAINT band_events_my_band_fk
  FOREIGN KEY (my_band_id, tenant_id) REFERENCES my_bands(id, tenant_id)
  ON DELETE SET NULL (my_band_id);

CREATE INDEX idx_gigs_my_band ON gigs (tenant_id, my_band_id)
  WHERE my_band_id IS NOT NULL;
CREATE INDEX idx_rehearsals_my_band ON rehearsals (tenant_id, my_band_id)
  WHERE my_band_id IS NOT NULL;
CREATE INDEX idx_band_events_my_band ON band_events (tenant_id, my_band_id)
  WHERE my_band_id IS NOT NULL;
