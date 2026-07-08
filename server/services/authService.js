// Authentication domain logic: the /me payload, the post-OIDC user bootstrap,
// and tenant-access checks. The route owns OIDC and session (regenerate/save/
// destroy) wiring plus audit logging, which need `req`/`req.session`.
import {
  fetchUserById,
  listMembershipsForMe,
  getBandMemberId,
  anySuperAdminExists,
  updateUserOnLogin,
  emailExists,
  insertUserFromClaims,
  setProviderSub,
  clearProviderSub,
  upsertSeedAdminMembership,
  firstApprovedTenantId,
  isApprovedMember,
} from '../repositories/authRepository.js'
import { permissionsForRole } from '../auth/permissions.js'
import { resolveTenantEntitlements } from './entitlementService.js'

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

  // Entitlements of the active tenant (owner's subscription). null = ownerless
  // tenant, no enforcement — the frontend hides nothing and blocks nothing.
  let entitlements = null
  if (activeTenantId) {
    const resolved = await resolveTenantEntitlements(db, activeTenantId)
    if (resolved) {
      entitlements = {
        planSlug: resolved.planSlug,
        subscriptionStatus: resolved.subscriptionStatus,
        locked: resolved.locked,
        financeReadOnly: resolved.financeReadOnly,
        flags: resolved.entitlements.features,
        // Already reflects a pending-downgrade limits snapshot (growth UX).
        limits: resolved.entitlements.limits,
      }
    }
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
      entitlements,
      providers: {
        google: user.google_sub != null,
        microsoft: user.microsoft_sub != null,
      },
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

function accountExistsError() {
  const err = new Error('An account with this email already exists')
  err.status = 403
  err.code = 'account_exists'
  return err
}

// Resolves the signing-in user by provider sub ONLY. An email collision with
// an existing account is rejected — never auto-linked, never created: email
// equality is not proof of account ownership (see the explicit link flow for
// attaching a second provider).
async function resolveSignInUser(db, provider, claims, isSuperAdmin, status) {
  const existing = await updateUserOnLogin(db, provider, claims)
  if (existing) return existing

  if (await emailExists(db, claims.email)) throw accountExistsError()
  try {
    return await insertUserFromClaims(db, provider, claims, isSuperAdmin, status)
  } catch (err) {
    if (err.code === '23505') {
      // Lost a first-login race: same sub → the returning-user path now
      // succeeds; same email (other provider) → reject, fail closed.
      const retried = await updateUserOnLogin(db, provider, claims)
      if (retried) return retried
      throw accountExistsError()
    }
    throw err
  }
}

// Bootstraps the user after a successful OIDC callback: resolves the user by
// provider sub (the first-ever super admin is the ADMIN_EMAIL account),
// grants the seed-tenant admin membership for that bootstrap admin, and
// resolves the initial active tenant. Returns { user, activeTenantId } for
// the route to write into the regenerated session.
export async function bootstrapCallbackUser(db, provider, claims) {
  // Per-tenant membership.status is the real gate. New users land approved
  // globally so they can reach /api/invites/redeem and /auth/me; tenant access
  // still requires an approved membership in some tenant.
  //
  // Super-admin bootstrap additionally demands a strictly-boolean verified
  // email claim: an IdP that doesn't assert verification (Microsoft consumers
  // never does) can never mint the super admin by presenting ADMIN_EMAIL.
  const bootstrapAdmin =
    !(await anySuperAdminExists(db)) &&
    claims.email === process.env.ADMIN_EMAIL &&
    claims.email_verified === true

  const user = await resolveSignInUser(db, provider, claims, bootstrapAdmin, 'approved')
  if (bootstrapAdmin) {
    await upsertSeedAdminMembership(db, user.id)
  }

  const activeTenantId = await firstApprovedTenantId(db, user.id)
  return { user, activeTenantId }
}

// Attaches a second provider identity to an authenticated user. Only fills an
// empty slot; a sub already bound to any account is refused. Callers own the
// proof-of-ownership gate (fresh primary re-auth) — this just enforces the
// storage invariants.
export async function linkProviderIdentity(db, userId, provider, claims) {
  try {
    const linked = await setProviderSub(db, userId, provider, claims.sub)
    if (!linked) {
      return { error: { status: 409, body: { error: 'A sign-in method of this type is already linked', code: 'slot_occupied' } } }
    }
  } catch (err) {
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'This sign-in is already linked to another account', code: 'sub_taken' } } }
    }
    throw err
  }
  return {}
}

// Prepares an explicit link flow: refuses when the target slot is already
// filled and picks the provider whose fresh re-authentication proves the user
// owns this account (their existing sign-in method).
export async function startLinkContext(db, userId, targetProvider) {
  const user = await fetchUserById(db, userId)
  if (!user) return { error: { status: 401, body: { error: 'Unauthorized' } } }

  const subs = { google: user.google_sub, microsoft: user.microsoft_sub }
  if (subs[targetProvider]) {
    return { error: { status: 409, body: { error: 'A sign-in method of this type is already linked', code: 'already_linked' } } }
  }
  const primaryProvider = Object.keys(subs).find((p) => p !== targetProvider && subs[p])
  if (!primaryProvider) {
    return { error: { status: 409, body: { error: 'No existing sign-in method to re-authenticate with', code: 'no_primary' } } }
  }
  return { primaryProvider }
}

// True only when the re-auth callback's sub is the exact identity already
// stored for this user — a fresh credential entry for the same account, not
// just any session at the IdP.
export async function matchesProviderSub(db, userId, provider, sub) {
  const user = await fetchUserById(db, userId)
  if (!user || typeof sub !== 'string' || sub === '') return false
  const stored = provider === 'google' ? user.google_sub : user.microsoft_sub
  return stored === sub
}

export async function unlinkProvider(db, userId, provider) {
  const cleared = await clearProviderSub(db, userId, provider)
  if (!cleared) {
    return { error: { status: 409, body: { error: 'Cannot remove the only sign-in method', code: 'last_provider' } } }
  }
  return {}
}

export async function canUseTenant(db, userId, tenantId) {
  return isApprovedMember(db, userId, tenantId)
}
