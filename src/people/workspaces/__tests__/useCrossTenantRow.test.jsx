import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../contexts/authContext.ts', () => ({ useAuth: vi.fn() }))

import { useAuth } from '../../../contexts/authContext.ts'
import { useCrossTenantRow } from '../../../planning/shared/useCrossTenantRow.ts'

// The viewer sits in tenant 1; rows carrying `tenantId` came through /api/me.
function asUser({ tenantId = 1, permissions = ['planning.write'] } = {}) {
  useAuth.mockReturnValue({ user: { id: 7, activeTenantId: tenantId, permissions } })
}

beforeEach(() => {
  vi.clearAllMocks()
  asUser()
})

describe('useCrossTenantRow', () => {
  it('treats a row from another tenant as cross-band and read-only', () => {
    const { result } = renderHook(() => useCrossTenantRow({ id: 5, tenantId: 9 }))

    expect(result.current.isCrossBand).toBe(true)
    expect(result.current.canWrite).toBe(false)
  })

  it('leaves a row from the active tenant writable', () => {
    const { result } = renderHook(() => useCrossTenantRow({ id: 5, tenantId: 1 }))

    expect(result.current.isCrossBand).toBe(false)
    expect(result.current.canWrite).toBe(true)
  })

  // Tenant-scoped endpoints don't label their rows, so an absent tenantId means
  // "the active tenant's own row" — not "unknown, assume foreign".
  it('treats an unlabeled row as the active tenant’s', () => {
    const { result } = renderHook(() => useCrossTenantRow({ id: 5 }))

    expect(result.current.isCrossBand).toBe(false)
    expect(result.current.canWrite).toBe(true)
  })

  // The row is still loading (or the caller withheld a stale one): claiming
  // cross-band here flickers a read-only banner over a row that turns out to be
  // the viewer's own. Write, though, fails closed — an unknown row must not put
  // save/delete affordances on screen before ownership is settled.
  it('is not cross-band before a row is available, but is not writable either', () => {
    const { result } = renderHook(() => useCrossTenantRow(null))

    expect(result.current.isCrossBand).toBe(false)
    expect(result.current.canWrite).toBe(false)
  })

  // A failed load leaves the row null for good, so the deny is permanent, not
  // just a loading flicker.
  it('withholds write on an undefined row', () => {
    const { result } = renderHook(() => useCrossTenantRow(undefined))

    expect(result.current.canWrite).toBe(false)
  })

  it('denies write to a reader on an own-tenant row', () => {
    asUser({ permissions: [] })
    const { result } = renderHook(() => useCrossTenantRow({ id: 5, tenantId: 1 }))

    expect(result.current.isCrossBand).toBe(false)
    expect(result.current.canWrite).toBe(false)
  })

  it('intersects an explicit base capability with the cross-band rule', () => {
    const own = renderHook(() => useCrossTenantRow({ id: 5, tenantId: 1 }, { canWrite: false }))
    expect(own.result.current.canWrite).toBe(false)

    const foreign = renderHook(() => useCrossTenantRow({ id: 5, tenantId: 9 }, { canWrite: true }))
    expect(foreign.result.current.isCrossBand).toBe(true)
    expect(foreign.result.current.canWrite).toBe(false)
  })

  // A super admin still can't write into a tenant they aren't currently in.
  it('does not let a super admin write a foreign row', () => {
    useAuth.mockReturnValue({ user: { id: 7, activeTenantId: 1, isSuperAdmin: true } })
    const { result } = renderHook(() => useCrossTenantRow({ id: 5, tenantId: 9 }))

    expect(result.current.canWrite).toBe(false)
  })

  it('withholds write while the active tenant is unresolved', () => {
    useAuth.mockReturnValue({ user: undefined })
    const { result } = renderHook(() => useCrossTenantRow({ id: 5, tenantId: 9 }))

    expect(result.current.isCrossBand).toBe(true)
    expect(result.current.canWrite).toBe(false)
  })

  it('keeps a stable identity across renders with the same inputs', () => {
    const { result, rerender } = renderHook(({ row }) => useCrossTenantRow(row), {
      initialProps: { row: { id: 5, tenantId: 9 } },
    })
    const first = result.current

    rerender({ row: { id: 5, tenantId: 9 } })

    expect(result.current).toBe(first)
  })
})
