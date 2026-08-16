// Quoting: turn a subscription's module set into a price snapshot, and keep the
// next renewal's amount in step with the live discount catalog.
//
// The maths itself is pure and lives in shared/pricing.js — the same module the
// frontend previews with, so a quote shown to a customer and the amount charged
// cannot drift. This layer only supplies the inputs (modules, the live rules)
// and persists the result.
import { computePriceSnapshot, computeProrationCents } from '../../../shared/pricing.js'
import { listActivePricingRules } from '../pricing/pricingRuleService.js'
import { listModules } from './subscriptionModuleRepository.js'
import {
  fetchSubscriptionById,
  setNextPriceSnapshot,
} from './subscriptionRepository.js'

// A module row carries its plan's pricing columns through the repository's
// join; rebuild the plan shape shared/pricing.js expects.
function planRowOf(module) {
  return {
    id: module.plan_id,
    slug: module.plan_slug,
    monthly_price_cents: module.monthly_price_cents,
    yearly_price_cents: module.yearly_price_cents,
  }
}

function pendingPlanRowOf(module) {
  return {
    id: module.pending_plan_id,
    slug: module.pending_plan_slug,
    monthly_price_cents: module.pending_monthly_price_cents,
    yearly_price_cents: module.pending_yearly_price_cents,
  }
}

// What the customer is charged for RIGHT NOW: everything they already have,
// excluding a module bought but not yet paid for.
export function currentModuleSet(modules) {
  return modules
    .filter((m) => m.status !== 'pending')
    .map((m) => ({ audience: m.audience, plan: planRowOf(m) }))
}

// What the NEXT renewal charges: pending adds are included (they will have been
// paid for by then), removals are dropped, and a scheduled downgrade bills the
// plan it lands on.
export function nextModuleSet(modules) {
  return modules
    .filter((m) => m.pending_change_kind !== 'remove')
    .map((m) => ({
      audience: m.audience,
      plan: m.pending_plan_id ? pendingPlanRowOf(m) : planRowOf(m),
    }))
}

// The current set with one ladder's module replaced by (or added as) `plan` —
// what a change to that ladder would be priced against.
export function moduleSetWith(modules, audience, plan) {
  const others = currentModuleSet(modules).filter((m) => m.audience !== audience)
  return [...others, { audience, plan }]
}

// Quote a concrete module set. `modules` is [{ audience, plan }] with plan rows
// straight from the catalog.
export async function quote(db, { modules, interval, now = new Date() }) {
  const rules = await listActivePricingRules(db)
  return computePriceSnapshot({ modules, rules, interval, now })
}

// The same module set priced for several intervals at once — one rules read
// instead of one per interval, and one `now` so the quotes cannot straddle a
// discount's effective boundary. Returns { [interval]: snapshot }.
export async function quoteIntervals(db, { modules, intervals, now = new Date() }) {
  const rules = await listActivePricingRules(db)
  return Object.fromEntries(intervals.map((interval) => [
    interval, computePriceSnapshot({ modules, rules, interval, now }),
  ]))
}

export { computeProrationCents }

// Recompute what the NEXT renewal will charge and store it. Called whenever the
// configuration changes and by the scheduler, so a time-limited discount that
// has lapsed (or just started) reaches the provider schedule before the next
// charge instead of silently persisting for one more cycle.
//
// setNextPriceSnapshot flags the schedule stale only when the amount actually
// moves, so a no-op tick costs one UPDATE and no provider traffic.
export async function repriceSubscription(db, subId, { now = new Date() } = {}) {
  const sub = await fetchSubscriptionById(db, subId)
  if (!sub || sub.status === 'canceled' || sub.is_complimentary) return null
  if (!sub.billing_interval) return null // still trialling, no cycle to price

  const nextModules = nextModuleSet(await listModules(db, subId))

  // Every module gone at the boundary: the schedule is cancelled rather than
  // recreated at zero (repairSchedule handles that).
  if (nextModules.length === 0) {
    return setNextPriceSnapshot(db, subId, {
      snapshot: { modules: {}, subtotalCents: 0, discounts: [], totalCents: 0 },
      totalCents: 0,
    })
  }

  const rules = await listActivePricingRules(db)
  const snapshot = computePriceSnapshot({
    modules: nextModules, rules, interval: sub.billing_interval, now,
  })
  return setNextPriceSnapshot(db, subId, { snapshot, totalCents: snapshot.totalCents })
}
