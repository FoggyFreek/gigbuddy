// Canonical default subscription plan tiers. Migration 100 seeds these same
// rows in SQL for fresh databases; this module is the JS source of truth for
// tests (reseeding between cases) and any code that needs the baseline tiers.
// Keep the two in sync when the tier matrix changes.

export const DEFAULT_PLANS = Object.freeze([
  {
    slug: 'bronze',
    name: 'Bronze',
    // The free fallback tier: always active, always 0-priced.
    monthly_price_cents: 0,
    yearly_price_cents: 0,
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
      },
      limits: { storage_mb: 50, members: 5, bands: 1, linkpage_pages: 0, linkpage_stats_days: 30 },
    },
  },
  {
    slug: 'silver',
    name: 'Silver',
    // NULL price = interval unavailable until an admin sets a real price.
    monthly_price_cents: null,
    yearly_price_cents: null,
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
      },
      limits: { storage_mb: 150, members: null, bands: 3, linkpage_pages: 3, linkpage_stats_days: 30 },
    },
  },
  {
    slug: 'gold',
    name: 'Gold',
    monthly_price_cents: null,
    yearly_price_cents: null,
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
      },
      limits: { storage_mb: 500, members: null, bands: null, linkpage_pages: 30, linkpage_stats_days: 90 },
    },
  },
])

// Inserts any missing default plans. Existing rows (matched by slug) are left
// untouched so admin edits survive.
export async function seedDefaultPlans(executor) {
  for (const plan of DEFAULT_PLANS) {
    await executor.query(
      `INSERT INTO subscription_plans
         (slug, name, monthly_price_cents, yearly_price_cents, entitlements, is_active, is_fallback, sort_order)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)
       ON CONFLICT (slug) DO NOTHING`,
      [
        plan.slug,
        plan.name,
        plan.monthly_price_cents,
        plan.yearly_price_cents,
        plan.entitlements,
        plan.is_fallback,
        plan.sort_order,
      ],
    )
  }
}
