-- Gig deal terms: deal type, ticket economics, agency (booking) fee, commission
-- and an itemised list of the artist's own costs.
--
-- Money is integer cents throughout, percentages are NUMERIC(5,2) (15.50 = 15.5%).
-- Both agency fee and commission can be entered either as a percentage or as a
-- fixed amount, so each carries an explicit `*_basis` discriminator rather than
-- letting one column's NULL-ness mean "the other one applies".

-- ---------------------------------------------------------------------------
-- 1. booking_fee_cents → guaranteed_fee_cents (expand half of expand/contract)
-- ---------------------------------------------------------------------------
-- The column has always held the *guaranteed* fee the artist is paid, but this
-- feature introduces a Booking Fee that means the agency's cut — the opposite
-- side of the same deal. Renaming outright would break the previous app
-- container, which still serves while this migration runs, so the new name is
-- added alongside and a trigger mirrors writes in both directions. A later
-- deployment drops the trigger and the old column (see the contract note below).
ALTER TABLE gigs ADD COLUMN guaranteed_fee_cents INTEGER;

-- Migration 175 deliberately left legacy overnight gigs unvalidated while
-- introducing the end-date constraint. Any UPDATE rechecks it, so repair
-- those rows before the fee backfill below updates every gig.
UPDATE gigs
   SET end_date = event_date + 1
 WHERE end_date = event_date
   AND start_time IS NOT NULL
   AND end_time IS NOT NULL
   AND end_time < start_time;

UPDATE gigs SET guaranteed_fee_cents = booking_fee_cents;

CREATE OR REPLACE FUNCTION gigs_sync_guaranteed_fee() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Old container inserts booking_fee_cents, new one inserts guaranteed_fee_cents.
    IF NEW.guaranteed_fee_cents IS NULL THEN
      NEW.guaranteed_fee_cents := NEW.booking_fee_cents;
    ELSE
      NEW.booking_fee_cents := NEW.guaranteed_fee_cents;
    END IF;
    RETURN NEW;
  END IF;

  -- On UPDATE, whichever column the writer actually touched wins. Both being
  -- touched at once only happens if a writer sets them equal, which is a no-op.
  IF NEW.guaranteed_fee_cents IS DISTINCT FROM OLD.guaranteed_fee_cents THEN
    NEW.booking_fee_cents := NEW.guaranteed_fee_cents;
  ELSIF NEW.booking_fee_cents IS DISTINCT FROM OLD.booking_fee_cents THEN
    NEW.guaranteed_fee_cents := NEW.booking_fee_cents;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER gigs_sync_guaranteed_fee_trg
  BEFORE INSERT OR UPDATE ON gigs
  FOR EACH ROW EXECUTE FUNCTION gigs_sync_guaranteed_fee();

-- CONTRACT (a later deployment, once no container reads the old name):
--   DROP TRIGGER gigs_sync_guaranteed_fee_trg ON gigs;
--   DROP FUNCTION gigs_sync_guaranteed_fee();
--   ALTER TABLE gigs DROP COLUMN booking_fee_cents;

-- ---------------------------------------------------------------------------
-- 2. Deal terms
-- ---------------------------------------------------------------------------
ALTER TABLE gigs
  -- flat_fee       — fixed fee, no ticket revenue
  -- guarantee      — fee + share of ticket revenue past break-even (fee + venue costs)
  -- guarantee_plus — as above, but venue costs are optional in the break-even
  -- guarantee_vs   — the fee OR the ticket share, whichever is higher
  -- door_deal      — no fee, only a share of ticket revenue past break-even
  ADD COLUMN deal_type TEXT NOT NULL DEFAULT 'flat_fee'
    CHECK (deal_type IN ('flat_fee', 'guarantee', 'guarantee_plus', 'guarantee_vs', 'door_deal')),
  -- Only consulted for guarantee_plus; the other deal types have a fixed answer.
  ADD COLUMN breakeven_includes_venue_costs BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN venue_costs_cents INTEGER
    CHECK (venue_costs_cents IS NULL OR venue_costs_cents >= 0),
  ADD COLUMN venue_capacity INTEGER
    CHECK (venue_capacity IS NULL OR venue_capacity >= 0),
  ADD COLUMN expected_visitors INTEGER
    CHECK (expected_visitors IS NULL OR expected_visitors >= 0),
  ADD COLUMN tickets_sold INTEGER
    CHECK (tickets_sold IS NULL OR tickets_sold >= 0),
  ADD COLUMN ticket_price_net_cents INTEGER
    CHECK (ticket_price_net_cents IS NULL OR ticket_price_net_cents >= 0),
  ADD COLUMN ticket_price_gross_cents INTEGER
    CHECK (ticket_price_gross_cents IS NULL OR ticket_price_gross_cents >= 0),

  -- Booking fee owed to the artist's agency. Exclusive adds it on top of the
  -- gross fee, inclusive splits it out of the gross fee.
  ADD COLUMN agency_fee_basis TEXT NOT NULL DEFAULT 'none'
    CHECK (agency_fee_basis IN ('none', 'percentage', 'amount')),
  ADD COLUMN agency_fee_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (agency_fee_percentage >= 0 AND agency_fee_percentage <= 100),
  ADD COLUMN agency_fee_amount_cents INTEGER NOT NULL DEFAULT 0
    CHECK (agency_fee_amount_cents >= 0),
  ADD COLUMN agency_fee_mode TEXT NOT NULL DEFAULT 'exclusive'
    CHECK (agency_fee_mode IN ('exclusive', 'inclusive')),

  -- Commission, calculated from the nett fee (gross fee minus the artist's costs).
  ADD COLUMN commission_basis TEXT NOT NULL DEFAULT 'none'
    CHECK (commission_basis IN ('none', 'percentage', 'amount')),
  ADD COLUMN commission_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (commission_percentage >= 0 AND commission_percentage <= 100),
  ADD COLUMN commission_amount_cents INTEGER NOT NULL DEFAULT 0
    CHECK (commission_amount_cents >= 0);

-- Existing rows predate deal types. Migration 092 defined a gig carrying both a
-- fee and a ticket-sales percentage as "the band takes whichever is higher",
-- which is exactly a Guarantee vs.; a percentage with no fee is a door deal.
UPDATE gigs
   SET deal_type = CASE
     WHEN COALESCE(percentage_of_sales, 0) > 0 AND booking_fee_cents IS NOT NULL THEN 'guarantee_vs'
     WHEN COALESCE(percentage_of_sales, 0) > 0 THEN 'door_deal'
     ELSE 'flat_fee'
   END;

-- ---------------------------------------------------------------------------
-- 3. The artist's own costs, itemised (travel, backline, catering, …)
-- ---------------------------------------------------------------------------
-- Their sum is the "Costs" row of the artist statement. Composite FK is the
-- tenant-isolation backstop; depends on gigs_id_tenant_id_key (028).
CREATE TABLE gig_costs (
  id           SERIAL PRIMARY KEY,
  gig_id       INTEGER NOT NULL,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (gig_id, tenant_id) REFERENCES gigs(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX gig_costs_gig_idx ON gig_costs (gig_id, tenant_id);
