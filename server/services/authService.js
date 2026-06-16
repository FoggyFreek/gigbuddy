// Authentication domain logic: the /me payload, the post-OIDC user bootstrap,
// and tenant-access checks. The route owns OIDC and session (regenerate/save/
// destroy) wiring plus audit logging, which need `req`/`req.session`.
import {
  fetchUserById,
  listMembershipsForMe,
  getBandMemberId,
  anySuperAdminExists,
  upsertUserFromClaims,
  upsertSeedAdminMembership,
  firstApprovedTenantId,
  isApprovedMember,
} from '../repositories/authRepository.js'
import { permissionsForRole } from '../auth/permissions.js'

// Builds the /me payload for a user, resolving the active tenant. The session's
// preferred active tenant wins when it's still an approved membership, else the
// first approved membership. Returns { payload, activeTenantId } or null when the
// user no longer exists.
export async function buildMePayload(db, userId, sessionActiveTenantId) {
  const user = await fetchUserById(db, userId)
  if (!user) return null

  const memberships = await listMembershipsForMe(db, user.id)

  const approved = memberships.filter((m) => m.status === 'approved')
  let activeTenantId = sessionActiveTenantId ?? null
  let activeMembership = approved.find((m) => m.tenant_id === activeTenantId)
  if (!activeMembership) {
    activeMembership = approved[0] || null
    activeTenantId = activeMembership?.tenant_id ?? null
  }

  let bandMemberId = null
  if (activeTenantId) {
    bandMemberId = await getBandMemberId(db, user.id, activeTenantId)
  }

  return {
    payload: {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      pictureUrl: user.picture_url,
      isSuperAdmin: !!user.is_super_admin,
      activeTenantId,
      activeTenantRole: activeMembership?.role ?? null,
      permissions: activeMembership
        ? permissionsForRole(activeMembership.role, { isSuperAdmin: !!user.is_super_admin })
        : [],
      bandMemberId,
      memberships: memberships.map((m) => ({
        tenantId: m.tenant_id,
        tenantName: m.tenant_name,
        tenantSlug: m.tenant_slug,
        role: m.role,
        status: m.status,
      })),
    },
    activeTenantId,
  }
}

// Bootstraps the user after a successful OIDC callback: upserts the user (the
// first-ever super admin is the ADMIN_EMAIL account), grants the seed-tenant
// admin membership for that bootstrap admin, and resolves the initial active
// tenant. Returns { user, activeTenantId } for the route to write into the
// regenerated session.
export async function bootstrapCallbackUser(db, claims) {
  // Per-tenant membership.status is the real gate. New users land approved
  // globally so they can reach /api/invites/redeem and /auth/me; tenant access
  // still requires an approved membership in some tenant.
  const bootstrapAdmin = !(await anySuperAdminExists(db)) && claims.email === process.env.ADMIN_EMAIL

  const user = await upsertUserFromClaims(db, claims, bootstrapAdmin, 'approved')
  if (bootstrapAdmin) {
    await upsertSeedAdminMembership(db, user.id)
  }

  const activeTenantId = await firstApprovedTenantId(db, user.id)
  return { user, activeTenantId }
}

export async function canUseTenant(db, userId, tenantId) {
  return isApprovedMember(db, userId, tenantId)
}
