// The band directory: search bands that opted into discovery, and ask to join
// one. The single deliberate exception to "tenants are not discoverable" — and
// it is opt-in per band (`join_policy = 'request'`), never platform-wide.
//
// Invariants this file exists to protect:
//   - a tenant that has not opted in is INVISIBLE and 404s, exactly as today;
//   - `role` is fixed server-side, never read from the client: a self-service
//     requester has no admin's warrant behind them;
//   - a search result is a hint, never authorization — the target is
//     re-validated inside the join transaction;
//   - a rejected membership stays rejected; only an admin reopens that door.
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { logger } from '../../utils/logger.js'
import { PERMISSIONS, ROLES } from '../../auth/permissions.js'
import { MEMBERSHIP_SOURCES } from '../../domain/membership.js'
import { dispatchNotification } from '../../user/notifications/notificationService.js'
import { enforceJoinRequestCap } from '../../entitlements/limitService.js'
import { insertPendingMembership } from '../memberships/inviteRepository.js'
import {
  searchDiscoverableTenants,
  fetchDiscoverableTenant,
  fetchMembership,
  listOpenJoinRequests,
  deleteOwnJoinRequest,
} from './bandDirectoryRepository.js'
import {
  parseDirectorySearch,
  parseRequestMessage,
  parseTenantId,
} from './bandDirectoryValidators.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'

// Invariant 6: a band the caller isn't a member of and that hasn't opted in
// must be indistinguishable from one that doesn't exist.
const NOT_FOUND = notFound('Band not found')

function shapeSearchHit(row) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    logoPath: row.logo_path,
    membershipStatus: row.membership_status,
  }
}

export async function searchBands(db, userId, query) {
  const parsed = parseDirectorySearch(query)
  if (parsed.error) return badRequest(parsed.error)

  const rows = await searchDiscoverableTenants(db, {
    query: parsed.query,
    limit: parsed.limit,
    userId,
  })
  return { items: rows.map(shapeSearchHit), meta: { limit: parsed.limit } }
}

export async function listMyJoinRequests(db, userId) {
  const rows = await listOpenJoinRequests(db, userId)
  return {
    items: rows.map((r) => ({
      tenantId: r.id,
      slug: r.slug,
      displayName: r.display_name,
      requestMessage: r.request_message,
      createdAt: r.created_at,
    })),
  }
}

// Result semantics mirror invite redemption: fresh → 201 pending, already
// pending → 200 idempotent, already approved → 409.
export async function requestToJoinBand(db, user, body) {
  const target = parseTenantId(body?.tenantId)
  if (target.error) return badRequest(target.error)

  const parsedMessage = parseRequestMessage(body?.requestMessage)
  if (parsedMessage.error) return badRequest(parsedMessage.error)

  return withTransaction(async (client) => {
    // A search result is a hint, never authorization: re-check kind, policy and
    // archive state here, inside the transaction that writes.
    const tenant = await fetchDiscoverableTenant(client, target.tenantId)
    if (!tenant) abortTransaction(NOT_FOUND)

    const existing = await fetchMembership(client, user.id, tenant.id)
    if (existing) abortTransaction(existingMembershipResult(existing, tenant))

    // Cap first: it takes the user-row lock, serializing this whole
    // check-then-insert against a concurrent request by the same artist.
    const capError = await enforceJoinRequestCap(client, user.id)
    if (capError) abortTransaction(capError)

    // Role is fixed server-side, at the LEAST privileged role there is. The
    // invite path takes its role from a row an admin created; a self-service
    // requester has no such warrant, so they arrive as a reader and the band's
    // admins raise them when they approve. (Approving a pending tenant_admin
    // already requires a super admin — this is defence in depth.)
    await insertPendingMembership(
      client, user.id, tenant.id, ROLES.READER, MEMBERSHIP_SOURCES.REQUEST, parsedMessage.message,
    )

    return {
      created: true,
      result: shapeMembershipResult(tenant, 'pending'),
      notify: { tenantId: tenant.id, userName: user.name || user.email },
      // `source` is safe in an audit trail; the message body is not.
      audit: { action: 'membership.request', details: { tenantId: tenant.id } },
    }
  }, { db })
}

// An existing row decides the outcome without writing anything.
function existingMembershipResult(existing, tenant) {
  if (existing.status === 'approved') {
    return conflict('You are already a member of this band', { code: 'already_member' })
  }
  if (existing.status === 'rejected') {
    // A declined musician cannot re-ask on a loop. UNIQUE (user_id, tenant_id)
    // keeps the row; only an admin inviting them reopens the door. 404, not a
    // distinct code — "we said no" is not information the requester is owed.
    return NOT_FOUND
  }
  // Already pending → idempotent 200, whichever way that pending row arose.
  return { created: false, result: shapeMembershipResult(tenant, 'pending') }
}

function shapeMembershipResult(tenant, status) {
  return {
    tenant: { id: tenant.id, slug: tenant.slug, displayName: tenant.display_name },
    status,
  }
}

// Withdrawing is required, not optional: with a cap of three, an artist who
// asked three bands that never answered would otherwise be stuck forever.
export async function withdrawJoinRequest(db, userId, tenantIdParam) {
  const target = parseTenantId(tenantIdParam)
  if (target.error) return badRequest(target.error)

  const removed = await deleteOwnJoinRequest(db, userId, target.tenantId)
  // Nothing to withdraw — an approved membership, someone else's row, or no
  // row at all. All 404: none of them is this endpoint's business.
  if (!removed) return notFound('Join request not found')

  return { audit: { action: 'membership.request.withdraw', details: { tenantId: target.tenantId } } }
}

// Tells the band's admins someone asked to join. The audience is members
// holding members.manage — the only roles that can approve. Deliberately
// carries NO message text: it is free text from a stranger the band has not
// accepted yet, so the notification links to the pending list instead.
export function notifyJoinRequested({ tenantId, userName }) {
  return dispatchNotification({
    tenantId,
    type: 'membership-requested',
    title: 'Someone asked to join your band',
    body: userName,
    url: '/settings/members',
    sourceType: 'membership',
    sourceId: null,
    requiredPermission: PERMISSIONS.MEMBERS_MANAGE,
  }).catch((err) => logger.error('notification.dispatch_failed', { err, tenantId }))
}
