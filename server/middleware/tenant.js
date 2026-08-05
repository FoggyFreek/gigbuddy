import pool from '../db/index.js'
import { loadUser } from './auth.js'
import { setContextField } from '../utils/requestContextStore.js'
import { tenantKindNotSupported } from '../services/serviceErrors.js'
import { listApprovedMemberTenants } from '../repositories/tenantRepository.js'
import { tenantKindSupports } from '../../shared/tenantCapabilities.js'

async function fetchMembership(userId, tenantId) {
  const { rows } = await pool.query(
    `SELECT m.*,
            t.slug AS tenant_slug,
            t.band_name AS tenant_name,
            t.kind AS tenant_kind,
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
      req.tenantKind = membership.tenant_kind
      // For the entitlement gates: null = ownerless tenant, enforcement skipped.
      req.tenantOwnerUserId = membership.tenant_owner_user_id ?? null
      setContextField('tenantId', tenantId)
      next()
    } catch (e) {
      next(e)
    }
  })
}

// Sibling of resolveTenantId for the cross-tenant artist agenda, which
// deliberately departs from "every read is scoped by req.tenantId".
//
// Three rules this middleware exists to enforce:
//   1. it NEVER sets req.tenantId — aggregate reads can't be mistaken for scoped ones;
//   2. the tenant set is derived server-side from approved, non-archived
//      memberships, so a tenant id in a request body or query changes nothing;
//   3. an empty set is a valid state (a user with no memberships gets empty
//      items, not a 403).
export async function resolveMemberTenantIds(req, res, next) {
  loadUser(req, res, async (err) => {
    if (err) return next(err)
    if (!req.user) return
    try {
      const rows = await listApprovedMemberTenants(pool, req.user.id)
      req.memberTenants = rows.map((r) => ({
        tenantId: r.id,
        kind: r.kind,
        displayName: r.display_name,
        slug: r.slug,
        logoPath: r.logo_path,
        role: r.role,
      }))
      next()
    } catch (e) {
      next(e)
    }
  })
}

// 403, not 404: the caller is an approved member of this tenant and knows its
// kind, so there is nothing to conceal — the structured code lets the SPA show
// "not available here" instead of a generic error.
// Authoritative applicability gate for kind-specific surfaces. Prefer this to
// open-coded kind comparisons: the shared capability registry also drives the
// frontend, so visibility and backend enforcement cannot drift.
export function requireTenantCapability(capability) {
  return (req, res, next) => {
    if (tenantKindSupports(req.tenantKind, capability)) return next()
    const { status, body } = tenantKindNotSupported(req.tenantKind).error
    res.status(status).json(body)
  }
}

// Field-level variant for shared endpoints whose main resource applies to both
// kinds but a small set of fields belongs to one capability.
export function requireTenantCapabilityForBodyFields(capability, fields) {
  return requireTenantCapabilityWhen(
    capability,
    (req) => fields.some((field) => Object.hasOwn(req.body ?? {}, field)),
  )
}

// Predicate variant for shared resources whose applicability depends on a
// value rather than merely the presence of a field.
export function requireTenantCapabilityWhen(capability, applies) {
  return (req, res, next) => {
    if (!applies(req)) return next()
    return requireTenantCapability(capability)(req, res, next)
  }
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
