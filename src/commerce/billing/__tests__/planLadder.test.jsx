import { describe, expect, it } from 'vitest'
import { isCurrentPlan, planActionKind, ladderPlans } from '../planLadder.ts'

const plan = (over = {}) => ({
  id: 1, slug: 'silver', name: 'Silver', audience: 'band',
  monthly_price_cents: 999, yearly_price_cents: 9999,
  entitlements: { features: {}, limits: {} },
  is_active: true, is_fallback: false, sort_order: 2,
  ...over,
})

const sub = (over = {}) => ({
  id: 1, planId: 1, planSlug: 'silver', audience: 'band', status: 'active',
  billingInterval: 'month', priceCents: 999, cancelAtPeriodEnd: false,
  currentPeriodEnd: null, trialEndsAt: null, isComplimentary: false,
  complimentaryExpiresAt: null, pendingChange: null, downgradeScheduled: false,
  pendingLimitsSnapshot: null, scheduleStale: false, repairNeeded: false,
  ...over,
})

describe('planActionKind — within one ladder', () => {
  it('offers subscribe on a paid plan when there is no subscription', () => {
    expect(planActionKind(plan(), null, false, 0)).toBe('subscribe')
  })

  it('offers nothing on the free floor when there is no subscription', () => {
    expect(planActionKind(plan({ is_fallback: true }), null, false, 0)).toBeNull()
  })

  it('ranks by sort_order', () => {
    const current = sub()
    expect(planActionKind(plan({ id: 2, sort_order: 3 }), current, false, 2)).toBe('upgrade')
    expect(planActionKind(plan({ id: 3, sort_order: 1 }), current, false, 2)).toBe('downgrade')
    expect(planActionKind(plan({ id: 4, sort_order: 2 }), current, false, 2)).toBe('switch')
  })

  it('offers nothing on the plan already active', () => {
    expect(planActionKind(plan(), sub(), true, 2)).toBeNull()
  })
})

describe('planActionKind — across ladders', () => {
  // The regression this exists for: artist_gold once carried the highest
  // sort_order overall, so a gold subscriber saw "Upgrade" on it and the API
  // answered 400. Ranking must never cross the product boundary.
  it('offers nothing on a plan from the other audience', () => {
    const bandSub = sub({ audience: 'band' })
    const artistPlan = plan({ id: 9, slug: 'artist_gold', audience: 'artist', sort_order: 99 })
    expect(planActionKind(artistPlan, bandSub, false, 2)).toBeNull()
  })

  it('holds in the other direction too', () => {
    const artistSub = sub({ audience: 'artist' })
    expect(planActionKind(plan({ audience: 'band', sort_order: 1 }), artistSub, false, 2)).toBeNull()
  })
})

describe('isCurrentPlan', () => {
  it('without a subscription, the free floor is current', () => {
    expect(isCurrentPlan(null, plan({ is_fallback: true }), 'month')).toBe(true)
    expect(isCurrentPlan(null, plan(), 'month')).toBe(false)
  })

  it('matches on plan and interval', () => {
    expect(isCurrentPlan(sub(), plan(), 'month')).toBe(true)
    expect(isCurrentPlan(sub(), plan(), 'year')).toBe(false)
  })

  it('a complimentary grant has no interval, so plan id alone decides', () => {
    const grant = sub({ isComplimentary: true, billingInterval: null })
    expect(isCurrentPlan(grant, plan(), 'year')).toBe(true)
  })
})

describe('ladderPlans', () => {
  const all = [
    plan({ id: 1, slug: 'gold', audience: 'band', sort_order: 3 }),
    plan({ id: 2, slug: 'bronze', audience: 'band', sort_order: 1 }),
    plan({ id: 3, slug: 'artist_gold', audience: 'artist', sort_order: 2 }),
    plan({ id: 4, slug: 'artist_hidden', audience: 'artist', sort_order: 1, is_active: false }),
  ]

  it('keeps one audience and ranks it', () => {
    expect(ladderPlans(all, 'band').map((p) => p.slug)).toEqual(['bronze', 'gold'])
  })

  it('can drop inactive plans', () => {
    expect(ladderPlans(all, 'artist').map((p) => p.slug)).toEqual(['artist_hidden', 'artist_gold'])
    expect(ladderPlans(all, 'artist', { activeOnly: true }).map((p) => p.slug)).toEqual(['artist_gold'])
  })

  it('does not mutate the input', () => {
    const before = all.map((p) => p.slug)
    ladderPlans(all, 'band')
    expect(all.map((p) => p.slug)).toEqual(before)
  })
})
