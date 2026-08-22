import { describe, expect, it } from 'vitest'
import {
  isCurrentPlan, planActionKind, ladderPlans, moduleFor, trialTierPlan,
} from '../planLadder.ts'

// Band and artist are still two independent products; they are just modules of
// one subscription now. These helpers decide what a plan card offers WITHIN one
// ladder — the guard that keeps the UI from proposing something the API rejects.

const plan = (over = {}) => ({
  id: 1, slug: 'silver', name: 'Silver', audience: 'band',
  monthly_price_cents: 999, yearly_price_cents: 9999,
  entitlements: { features: {}, limits: {} },
  is_active: true, is_fallback: false, is_trial_tier: false, sort_order: 2,
  ...over,
})

const BRONZE = plan({ id: 10, slug: 'bronze', name: 'Bronze', is_fallback: true, sort_order: 1, monthly_price_cents: 0, yearly_price_cents: 0 })
const SILVER = plan({ id: 11, sort_order: 2 })
const GOLD = plan({ id: 12, slug: 'gold', name: 'Gold', sort_order: 3, is_trial_tier: true })
const ARTIST_GOLD = plan({ id: 20, slug: 'artist_gold', name: 'Artist Gold', audience: 'artist', sort_order: 2, is_trial_tier: true })

const module = (over = {}) => ({
  audience: 'band', planId: SILVER.id, planSlug: 'silver', status: 'active',
  priceCents: 999, isStarter: true,
  pendingPlanId: null, pendingPlanSlug: null, pendingChangeKind: null,
  pendingLimitsSnapshot: null,
  ...over,
})

describe('moduleFor', () => {
  it('finds the module governing a ladder', () => {
    const sub = { modules: [module(), module({ audience: 'artist', planId: ARTIST_GOLD.id })] }
    expect(moduleFor(sub, 'band').planId).toBe(SILVER.id)
    expect(moduleFor(sub, 'artist').planId).toBe(ARTIST_GOLD.id)
  })

  it('is null when the customer never bought that product', () => {
    expect(moduleFor({ modules: [module()] }, 'artist')).toBeNull()
    expect(moduleFor(null, 'band')).toBeNull()
  })
})

describe('isCurrentPlan', () => {
  it('matches the module’s plan', () => {
    expect(isCurrentPlan(module(), SILVER)).toBe(true)
    expect(isCurrentPlan(module(), GOLD)).toBe(false)
  })

  it('treats the free floor as current when there is no module', () => {
    expect(isCurrentPlan(null, BRONZE)).toBe(true)
    expect(isCurrentPlan(null, SILVER)).toBe(false)
  })

  it('still reports the CURRENT plan while a change is scheduled', () => {
    // The downgrade has not happened yet; saying otherwise would offer to
    // "upgrade" back to the plan they are still on.
    const scheduled = module({ planId: GOLD.id, pendingPlanId: SILVER.id, pendingChangeKind: 'downgrade' })
    expect(isCurrentPlan(scheduled, GOLD)).toBe(true)
    expect(isCurrentPlan(scheduled, SILVER)).toBe(false)
  })
})

describe('planActionKind', () => {
  it('offers "add" on a paid plan when the ladder has no module', () => {
    expect(planActionKind(SILVER, null, 'band', 0)).toBe('add')
    expect(planActionKind(GOLD, null, 'band', 0)).toBe('add')
  })

  it('offers nothing on the free floor when there is no module — that IS the free plan', () => {
    expect(planActionKind(BRONZE, null, 'band', 0)).toBeNull()
  })

  it('offers nothing on the plan the module is already on', () => {
    expect(planActionKind(SILVER, module(), 'band', SILVER.sort_order)).toBeNull()
  })

  it('ranks by sort_order within the ladder', () => {
    expect(planActionKind(GOLD, module(), 'band', SILVER.sort_order)).toBe('upgrade')
    const onGold = module({ planId: GOLD.id, planSlug: 'gold' })
    expect(planActionKind(SILVER, onGold, 'band', GOLD.sort_order)).toBe('downgrade')
  })

  it('offers the free floor as a REMOVAL — having no module is the free plan', () => {
    expect(planActionKind(BRONZE, module(), 'band', SILVER.sort_order)).toBe('remove')
  })

  it('never offers an action for a plan on the other ladder', () => {
    expect(planActionKind(ARTIST_GOLD, module(), 'band', SILVER.sort_order)).toBeNull()
    expect(planActionKind(GOLD, null, 'artist', 0)).toBeNull()
  })
})

describe('ladderPlans', () => {
  it('keeps one audience and ranks it', () => {
    const ranked = ladderPlans([GOLD, ARTIST_GOLD, BRONZE, SILVER], 'band')
    expect(ranked.map((p) => p.slug)).toEqual(['bronze', 'silver', 'gold'])
  })

  it('can drop inactive plans', () => {
    const retired = plan({ id: 99, slug: 'old', is_active: false, sort_order: 4 })
    expect(ladderPlans([SILVER, retired], 'band', { activeOnly: true }).map((p) => p.slug))
      .toEqual(['silver'])
  })
})

describe('trialTierPlan', () => {
  it('finds the flagged trial tier per ladder', () => {
    const plans = [BRONZE, SILVER, GOLD, ARTIST_GOLD]
    expect(trialTierPlan(plans, 'band').slug).toBe('gold')
    expect(trialTierPlan(plans, 'artist').slug).toBe('artist_gold')
  })

  it('is null when the catalog designates none', () => {
    expect(trialTierPlan([BRONZE, SILVER], 'band')).toBeNull()
  })
})
