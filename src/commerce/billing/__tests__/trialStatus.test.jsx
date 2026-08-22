import { describe, expect, it } from 'vitest'
import { trialPhase } from '../trialStatus.ts'
import { PERIOD_GRACE_MS } from '../../../auth/entitlements.ts'

const ENDED_AT = new Date('2026-08-16T00:00:00Z')

const subscription = (overrides = {}) => ({
  status: 'trialing',
  convertedAt: null,
  paymentMethodReady: false,
  trialEndsAt: ENDED_AT.toISOString(),
  ...overrides,
})

const at = (offsetMs) => new Date(ENDED_AT.getTime() + offsetMs)

describe('trialPhase', () => {
  it('is grace right after the trial runs out — the modules still grant it', () => {
    const state = { subscription: subscription(), trialAvailable: false }
    expect(trialPhase(state, at(1000))).toBe('grace')
    expect(trialPhase(state, at(PERIOD_GRACE_MS - 1000))).toBe('grace')
  })

  it('is ended once the grace window has closed', () => {
    const state = { subscription: subscription(), trialAvailable: false }
    expect(trialPhase(state, at(PERIOD_GRACE_MS + 1000))).toBe('ended')
  })

  it('is null while the trial is still running', () => {
    const state = { subscription: subscription(), trialAvailable: false }
    expect(trialPhase(state, at(-1000))).toBeNull()
  })

  it('is null when a payment method will convert the trial', () => {
    const state = { subscription: subscription({ paymentMethodReady: true }), trialAvailable: false }
    expect(trialPhase(state, at(1000))).toBeNull()
  })

  it('is null for a paid subscription', () => {
    const state = {
      subscription: subscription({ status: 'active', convertedAt: ENDED_AT.toISOString() }),
      trialAvailable: false,
    }
    expect(trialPhase(state, at(1000))).toBeNull()
  })

  it('is ended when the trial is spent and no subscription is live', () => {
    expect(trialPhase({ subscription: null, trialAvailable: false }, at(0))).toBe('ended')
  })

  it('is null for a user who never started a trial', () => {
    expect(trialPhase({ subscription: null, trialAvailable: true }, at(0))).toBeNull()
  })
})
