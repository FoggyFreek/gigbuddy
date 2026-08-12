import { useMemo } from 'react'
import { useAuth } from '../contexts/authContext.ts'
import { usePermissions } from './usePermissions.ts'
import type { CrossTenantRef } from '../types/api.ts'
import type { Id } from '../types/entities.ts'

export interface CrossTenantRowApi {
  /** The row belongs to one of the viewer's other bands, not the active tenant. */
  isCrossBand: boolean
  /** The base capability, revoked for a cross-band row. */
  canWrite: boolean
}

export interface CrossTenantRowOptions {
  /** Capability to intersect with; defaults to `planning.write`. */
  canWrite?: boolean
}

// The calculation itself, for the rows of a list — where a hook can't be called
// per row. `useCrossTenantRow` is the hook form and the only other caller, so
// "which band does this row belong to" is answered in exactly one place.
export function isCrossTenantRow(
  row: Partial<CrossTenantRef> | null | undefined,
  activeTenantId: Id | null | undefined,
): boolean {
  const rowTenantId = row?.tenantId ?? null
  return rowTenantId !== null && rowTenantId !== (activeTenantId ?? null)
}

// Read-only-for-foreign-rows, in one place.
//
// A row that came through the cross-tenant hub (`/api/me/*`) carries the
// tenant it belongs to; a tenant-scoped read never labels its rows, because
// they are all the active tenant's. So the label itself is the signal: an
// unlabeled row is ours, a labeled one is foreign only if the id differs.
// Nothing on a detail view may write into a tenant the viewer isn't in, so a
// cross-band row is read-only whatever the viewer's role says.
//
// Pass `null` while the row is loading, when the load failed, or when the one in
// state is stale (a split-view id change). Such a row is *unknown*, not known to
// be ours, so the two outputs part ways: it isn't announced as cross-band — that
// would flicker a foreign-band banner over a row that turns out to be the
// viewer's own — but it isn't writable either, so save and delete affordances
// stay hidden until ownership is settled. An absent `tenantId` on a row that did
// arrive is still ours: tenant-scoped endpoints never label.
//
// This is UX only; the backend is authoritative — /api/me is a read-only
// surface and the tenant-scoped routes 404 outside `req.tenantId`.
export function useCrossTenantRow(
  row: Partial<CrossTenantRef> | null | undefined,
  options: CrossTenantRowOptions = {},
): CrossTenantRowApi {
  const { user } = useAuth()
  const { canWritePlanning } = usePermissions()

  const rowResolved = row != null
  const baseCanWrite = options.canWrite ?? canWritePlanning
  const isCrossBand = isCrossTenantRow(row, user?.activeTenantId)

  // Memoized on the derived booleans, not on the row's identity, so a caller
  // passing a fresh object every render still gets a stable result.
  return useMemo(
    () => ({ isCrossBand, canWrite: rowResolved && baseCanWrite && !isCrossBand }),
    [isCrossBand, rowResolved, baseCanWrite],
  )
}
