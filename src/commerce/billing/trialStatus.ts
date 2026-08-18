import { PERIOD_GRACE_MS } from '../../auth/entitlements.ts'
import type { BillingState } from './billing.ts'

/**
 * Where a spent trial stands right now.
 *
 * `grace`  — the trial ran out, but the entitlement resolver still unlocks the
 *            trial features for PERIOD_GRACE_MS and the modules still point at
 *            the paid plan. Nothing has been taken away yet.
 * `ended`  — the grace is over: the modules are back on the free fallback plan
 *            (or the reconciler has already closed the subscription).
 * `null`   — no spent trial to talk about.
 */
export type TrialPhase = 'grace' | 'ended' | null

// The two shapes exist because the server closes a lapsed trial on a delay: the
// row keeps saying `trialing` until the reconciler sweeps it, so the dates —
// not the status — decide which side of the grace window the user is on. That
// is exactly the boundary the resolver enforces on read, hence the shared
// PERIOD_GRACE_MS rather than a second copy of the number here.
export function trialPhase(state: BillingState, now: Date = new Date()): TrialPhase {
  const sub = state.subscription
  // No live subscription and the trial is spent: it ran out and was closed.
  // (A customer who converted and later cancelled lands here too — once the row
  // is gone the payload cannot tell the two apart.)
  if (!sub) return state.trialAvailable ? null : 'ended'

  // A converted trial, or one with a mandate ready to convert, is not lapsing.
  if (sub.status !== 'trialing' || sub.convertedAt || sub.paymentMethodReady) return null
  if (sub.trialEndsAt === null) return null

  const endedAt = new Date(sub.trialEndsAt).getTime()
  if (now.getTime() < endedAt) return null
  return now.getTime() < endedAt + PERIOD_GRACE_MS ? 'grace' : 'ended'
}
