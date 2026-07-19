import { describe, it, expect } from 'vitest'
import { pageEntitlements } from '../server/entitlements.js'

describe('pageEntitlements', () => {
  it('defaults to enabled with a 30-day window when the snapshot has no plan data', () => {
    expect(pageEntitlements({})).toEqual({ enabled: true, maxReleasePages: null, statsRetentionDays: 30 })
    expect(pageEntitlements(null)).toEqual({ enabled: true, maxReleasePages: null, statsRetentionDays: 30 })
  })

  it('honors a silver-style snapshot: 3 pages, 30-day window', () => {
    const e = pageEntitlements({ entitlements: { enabled: true, maxReleasePages: 3, statsRetentionDays: 30 } })
    expect(e).toEqual({ enabled: true, maxReleasePages: 3, statsRetentionDays: 30 })
  })

  it('honors a gold-style snapshot: 30 pages, 90-day window', () => {
    const e = pageEntitlements({ entitlements: { enabled: true, maxReleasePages: 30, statsRetentionDays: 90 } })
    expect(e).toEqual({ enabled: true, maxReleasePages: 30, statsRetentionDays: 90 })
  })

  it('disables the page when the feature is off (lapsed plan)', () => {
    const e = pageEntitlements({ entitlements: { enabled: false, maxReleasePages: 0, statsRetentionDays: 30 } })
    expect(e.enabled).toBe(false)
  })

  it('clamps the window to 30 or 90 — nothing else', () => {
    const days = (v) => pageEntitlements({ entitlements: { statsRetentionDays: v } }).statsRetentionDays
    expect(days(90)).toBe(90)
    expect(days(365)).toBe(90)
    expect(days(60)).toBe(30)
    expect(days(0)).toBe(30)
    expect(days('junk')).toBe(30)
  })

  it('treats malformed page caps as unlimited rather than blocking creation', () => {
    expect(pageEntitlements({ entitlements: { maxReleasePages: 'many' } }).maxReleasePages).toBeNull()
    expect(pageEntitlements({ entitlements: { maxReleasePages: -1 } }).maxReleasePages).toBeNull()
  })
})
