// Canonical default subscription plan tiers. Migration 100 seeds these same
// rows in SQL for fresh databases; this module is the JS source of truth for
// tests (reseeding between cases) and any code that needs the baseline tiers.
// Keep the two in sync when the tier matrix changes.
//
// Plans are two independent PRODUCTS (shared/planAudiences.js): the band ladder
// and the artist ladder. `sort_order` ranks WITHIN an audience — comparing it
// across audiences is meaningless, since there is no upgrade path between them.
import { PLAN_AUDIENCES } from '../../shared/planAudiences.js'

export const DEFAULT_PLANS = Object.freeze([
  {
    slug: 'bronze',
    name: 'Bronze',
    audience: PLAN_AUDIENCES.BAND,
    // The free fallback tier: always active, always 0-priced.
    monthly_price_cents: 0,
    yearly_price_cents: 0,
    is_active: true,
    is_fallback: true,
    sort_order: 1,
    entitlements: {
      features: {
        finance: false,
        integrations: false,
        customization: false,
        song_files: false,
        chordpro: false,
        public_promotion: false,
        linkpage: false,
        custom_slug: false,
        calendar_sync: false,
      },
      limits: { storage_mb: 50, members: 5, bands: 1, linkpage_pages: 0, linkpage_stats_days: 30 },
    },
  },
  {
    slug: 'silver',
    name: 'Silver',
    audience: PLAN_AUDIENCES.BAND,
    // NULL price = interval unavailable until an admin sets a real price.
    monthly_price_cents: null,
    yearly_price_cents: null,
    is_active: true,
    is_fallback: false,
    sort_order: 2,
    entitlements: {
      features: {
        finance: false,
        integrations: true,
        customization: true,
        song_files: true,
        chordpro: true,
        public_promotion: true,
        linkpage: true,
        custom_slug: false,
        calendar_sync: true,
      },
      limits: { storage_mb: 150, members: null, bands: 3, linkpage_pages: 3, linkpage_stats_days: 30 },
    },
  },
  {
    slug: 'gold',
    name: 'Gold',
    audience: PLAN_AUDIENCES.BAND,
    monthly_price_cents: null,
    yearly_price_cents: null,
    is_active: true,
    is_fallback: false,
    sort_order: 3,
    entitlements: {
      features: {
        finance: true,
        integrations: true,
        customization: true,
        song_files: true,
        chordpro: true,
        public_promotion: true,
        linkpage: true,
        custom_slug: true,
        calendar_sync: true,
      },
      limits: { storage_mb: 500, members: null, bands: null, linkpage_pages: 30, linkpage_stats_days: 90 },
    },
  },
  {
    // The artist ladder's free floor. Mirrors bronze's storage deliberately: a
    // fallback plan has no downgrade, blocker, consent or purge path, so
    // shrinking it below the band floor would simply start rejecting uploads
    // from personal workspaces that are already above the new number.
    slug: 'artist_bronze',
    name: 'Artist Bronze',
    audience: PLAN_AUDIENCES.ARTIST,
    monthly_price_cents: 0,
    yearly_price_cents: 0,
    is_active: true,
    is_fallback: true,
    sort_order: 1,
    entitlements: {
      features: {
        finance: false,
        integrations: false,
        customization: false,
        song_files: false,
        chordpro: false,
        public_promotion: false,
        linkpage: false,
        custom_slug: false,
        calendar_sync: false,
      },
      limits: { storage_mb: 50, members: 1, bands: 0, linkpage_pages: 0, linkpage_stats_days: 30 },
    },
  },
  {
    // Artist tier: everything on, but `bands: 0` — the subscriber gets their
    // own personal workspace (excluded from the band cap) and plays in other
    // people's bands, which run on their own owners' plans.
    //
    // `bands` is vestigial on this ladder: the band cap reads the owner's BAND
    // subscription, never this one. It stays only because validateEntitlements
    // requires a complete limits object.
    slug: 'artist_gold',
    name: 'Artist Gold',
    audience: PLAN_AUDIENCES.ARTIST,
    monthly_price_cents: null,
    yearly_price_cents: null,
    is_active: true,
    is_fallback: false,
    sort_order: 2,
    entitlements: {
      features: {
        finance: true,
        integrations: true,
        customization: true,
        song_files: true,
        chordpro: true,
        public_promotion: true,
        // Link pages are a band surface (BAND_LINKPAGE capability) and this
        // plan owns no band, so the feature would never be reachable.
        linkpage: false,
        custom_slug: false,
        calendar_sync: true,
      },
      // Storage sits below band gold; `members: 1` matches a workspace of one.
      // Pricing-sheet knobs, not architecture.
      limits: { storage_mb: 250, members: 1, bands: 0, linkpage_pages: 0, linkpage_stats_days: 30 },
    },
  },
])

// Inserts any missing default plans. Existing rows (matched by slug) are left
// untouched so admin edits survive.
export async function seedDefaultPlans(executor) {
  for (const plan of DEFAULT_PLANS) {
    await executor.query(
      `INSERT INTO subscription_plans
         (slug, name, audience, monthly_price_cents, yearly_price_cents, entitlements,
          is_active, is_fallback, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (slug) DO NOTHING`,
      [
        plan.slug,
        plan.name,
        plan.audience,
        plan.monthly_price_cents,
        plan.yearly_price_cents,
        plan.entitlements,
        plan.is_active,
        plan.is_fallback,
        plan.sort_order,
      ],
    )
  }
}
