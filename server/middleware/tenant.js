import pool from '../db/index.js'
import { loadUser } from './auth.js'
import { setContextField } from '../utils/requestContextStore.js'

async function fetchMembership(userId, tenantId) {
  const { rows } = await pool.query(
    `SELECT m.*,
            t.slug AS tenant_slug,
            t.band_name AS tenant_name,
            t.archived_at AS tenant_archived_at,
            t.owner_user_id AS tenant_owner_user_id
     FROM memberships m
     JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = $1 AND m.tenant_id = $2`,
    [userId, tenantId],
  )
  return rows[0] || null
}

export async function resolveTenantId(req, res, next) {
  loadUser(req, res, async (err) => {
    if (err) return next(err)
    if (!req.user) return
    try {
      const tenantId = req.session?.activeTenantId ?? null
      if (!tenantId) {
        return res.status(403).json({ error: 'No active tenant' })
      }
      const membership = await fetchMembership(req.user.id, tenantId)
      if (membership?.status !== 'approved') {
        return res.status(403).json({ error: 'No active tenant' })
      }
      if (membership.tenant_archived_at) {
        return res.status(403).json({ error: 'Tenant is archived' })
      }
      req.tenantId = tenantId
      req.membership = membership
      // For the entitlement gates: null = ownerless tenant, enforcement skipped.
      req.tenantOwnerUserId = membership.tenant_owner_user_id ?? null
      setContextField('tenantId', tenantId)
      next()
    } catch (e) {
      next(e)
    }
  })
}

export function requireTenantMember(req, res, next) {
  if (req.membership?.status !== 'approved') {
    return res.status(403).json({ error: 'Forbidden' })
  }
  next()
}

// Tenant-admin authorization is expressed through the permission matrix
// (members.manage / tenant.manage) and enforced with requirePermission — see
// middleware/permissions.js and routes/index.js. There is intentionally no
// role-based requireTenantAdmin gate so the matrix stays the single source of
// truth for capabilities.

export function requireSuperAdmin(req, res, next) {
  loadUser(req, res, (err) => {
    if (err) return next(err)
    if (!req.user) return
    if (!req.user.is_super_admin) return res.status(403).json({ error: 'Forbidden' })
    next()
  })
}
