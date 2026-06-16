import { describe, expect, it } from 'vitest'
import * as fe from '../auth/permissions.ts'
import * as be from '../../server/auth/permissions.js'

// The matrix is defined once in shared/permissions.js; both the server and the
// frontend re-export it, so these assertions now hold by construction. The test
// is kept as a regression guard: if anyone re-introduces a hand-maintained
// matrix in either wrapper instead of re-exporting the shared source, parity
// breaks here.
const ROLES = ['reader', 'contributor', 'member', 'financial_admin', 'tenant_admin']

describe('permission matrix parity (frontend mirrors backend)', () => {
  it('exposes the same permission keys', () => {
    expect(new Set(Object.values(fe.PERMISSIONS))).toEqual(new Set(Object.values(be.PERMISSIONS)))
  })

  for (const role of ROLES) {
    it(`role "${role}" has identical permissions on both sides`, () => {
      const feSet = [...(fe.ROLE_PERMISSIONS[role] ?? [])].sort()
      const beSet = [...(be.ROLE_PERMISSIONS[role] ?? [])].sort()
      expect(feSet).toEqual(beSet)
    })
  }
})

describe('hasPermission truth table', () => {
  const { PERMISSIONS, hasPermission } = fe

  it('reader: view + self actions only', () => {
    expect(hasPermission('reader', PERMISSIONS.APP_VIEW)).toBe(true)
    expect(hasPermission('reader', PERMISSIONS.TASK_COMPLETE_SELF)).toBe(true)
    expect(hasPermission('reader', PERMISSIONS.PLANNING_WRITE)).toBe(false)
    expect(hasPermission('reader', PERMISSIONS.PURCHASE_CREATE)).toBe(false)
    expect(hasPermission('reader', PERMISSIONS.FINANCE_VIEW)).toBe(false)
  })

  it('contributor == member: planning + purchase, no finance', () => {
    for (const role of ['contributor', 'member']) {
      expect(hasPermission(role, PERMISSIONS.PLANNING_WRITE)).toBe(true)
      expect(hasPermission(role, PERMISSIONS.PURCHASE_CREATE)).toBe(true)
      expect(hasPermission(role, PERMISSIONS.FINANCE_VIEW)).toBe(false)
      expect(hasPermission(role, PERMISSIONS.FINANCE_MANAGE)).toBe(false)
    }
  })

  it('financial_admin: finance but no member management', () => {
    expect(hasPermission('financial_admin', PERMISSIONS.FINANCE_VIEW)).toBe(true)
    expect(hasPermission('financial_admin', PERMISSIONS.FINANCE_MANAGE)).toBe(true)
    expect(hasPermission('financial_admin', PERMISSIONS.MEMBERS_MANAGE)).toBe(false)
  })

  it('tenant_admin: everything in-tenant', () => {
    expect(hasPermission('tenant_admin', PERMISSIONS.MEMBERS_MANAGE)).toBe(true)
    expect(hasPermission('tenant_admin', PERMISSIONS.FINANCE_MANAGE)).toBe(true)
  })

  it('super admin bypasses every check', () => {
    for (const key of Object.values(PERMISSIONS)) {
      expect(hasPermission('reader', key, { isSuperAdmin: true })).toBe(true)
    }
  })

  it('unknown / null role grants nothing', () => {
    expect(hasPermission(null, PERMISSIONS.APP_VIEW)).toBe(false)
    expect(hasPermission('bogus', PERMISSIONS.APP_VIEW)).toBe(false)
  })
})
