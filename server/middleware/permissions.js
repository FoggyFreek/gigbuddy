// Capability gate. Mount after the `requireApproved` → `resolveTenantId` chain
// so `req.membership.role` and `req.user.is_super_admin` are populated. Returns
// 403 on denial (cross-tenant existence is hidden earlier by tenant-scoped
// queries that 404). Pairs with the static matrix in ../auth/permissions.js.
import { hasPermission } from '../auth/permissions.js'

export function requirePermission(key) {
  return (req, res, next) => {
    if (req.membership?.status !== 'approved') {
      return res.status(403).json({ error: 'Forbidden' })
    }
    if (hasPermission(req.membership.role, key, { isSuperAdmin: !!req.user?.is_super_admin })) {
      return next()
    }
    return res.status(403).json({ error: 'Forbidden' })
  }
}

// Convenience for guarding a single handler inline (same semantics as the
// router-level middleware above).
export function can(req, key) {
  if (req.membership?.status !== 'approved') return false
  return hasPermission(req.membership.role, key, { isSuperAdmin: !!req.user?.is_super_admin })
}
