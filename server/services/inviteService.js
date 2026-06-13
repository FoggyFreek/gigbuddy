// Invite domain logic. Route handlers stay thin and delegate here. Functions
// return { error: { status, body } } on expected failures and a domain payload
// on success. Because audit logging needs the request (ip/session), each
// function that should emit an audit event returns an `audit` descriptor
// { action, details } the route logs via auditLog(req, ...).
import { randomBytes } from 'node:crypto'
import pool from '../db/index.js'
import { ALLOWED_ROLES, parseExpiresInDays } from '../validators/inviteValidators.js'
import {
  listInvitesWithNames,
  insertInvite,
  revokeInvite as revokeInviteRow,
  claimInvite,
  inviteExists,
  getMembership,
  insertPendingMembership,
} from '../repositories/inviteRepository.js'

function badRequest(error) {
  return { status: 400, body: { error } }
}

function forbidden(error) {
  return { status: 403, body: { error } }
}

function notFound(error) {
  return { status: 404, body: { error } }
}

function conflict(error, extra = {}) {
  return { status: 409, body: { error, ...extra } }
}

function generateCode() {
  return randomBytes(24).toString('base64url')
}

function buildInviteUrl(code) {
  const base = process.env.APP_URL || ''
  return `${base.replace(/\/$/, '')}/redeem-invite?code=${encodeURIComponent(code)}`
}

function shapeInvite(row) {
  return {
    id: row.id,
    code: row.code,
    url: buildInviteUrl(row.code),
    tenant_id: row.tenant_id,
    role: row.role,
    created_by_user_id: row.created_by_user_id,
    created_by_name: row.created_by_name ?? null,
    created_at: row.created_at,
    expires_at: row.expires_at,
    used_at: row.used_at,
    used_by_user_id: row.used_by_user_id,
    used_by_name: row.used_by_name ?? null,
  }
}

function denied(reason, extra = {}) {
  return { action: 'invite.redeem.denied', details: { ...extra, reason } }
}

// ---------- admin ----------

export async function listInvites(db, tenantId) {
  const rows = await listInvitesWithNames(db, tenantId)
  return rows.map(shapeInvite)
}

export async function createInvite(db, tenantId, user, body) {
  const role = body?.role ?? 'member'
  if (!ALLOWED_ROLES.has(role)) return { error: badRequest('Invalid role') }
  if (role === 'tenant_admin' && !user?.is_super_admin) {
    return { error: forbidden('Only super admins can issue tenant_admin invites') }
  }
  const parsed = parseExpiresInDays(body?.expiresInDays)
  if (parsed.error) return { error: badRequest(parsed.error) }

  const row = await insertInvite(db, generateCode(), tenantId, role, user.id, parsed.expiresAt)
  return {
    invite: shapeInvite(row),
    audit: { action: 'invite.create', details: { inviteId: row.id, role, expiresAt: parsed.expiresAt } },
  }
}

export async function revokeInvite(db, tenantId, inviteId) {
  const revoked = await revokeInviteRow(db, inviteId, tenantId)
  if (!revoked) return { error: notFound('Invite not found') }
  return { audit: { action: 'invite.revoke', details: { inviteId } } }
}

// ---------- redeem ----------

// Atomically claims an invite and creates a pending membership. Each failure
// path rolls back the claim and returns an audit descriptor describing why.
export async function redeemInvite(user, body) {
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!code) return { error: badRequest('code is required'), audit: denied('missing_code') }
  if (user?.status === 'rejected') {
    return { error: forbidden('Account is not allowed to redeem invites'), audit: denied('rejected_user') }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const invite = await claimInvite(client, code, user.id)
    if (!invite) {
      const exists = await inviteExists(client, code)
      await client.query('ROLLBACK')
      return exists
        ? { error: conflict('Invite already used'), audit: denied('already_used') }
        : { error: notFound('Invite not found'), audit: denied('not_found') }
    }

    const inviteRef = { tenantId: invite.tenant_id, inviteId: invite.id }

    if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
      await client.query('ROLLBACK')
      return { error: { status: 410, body: { error: 'Invite has expired' } }, audit: denied('expired', inviteRef) }
    }
    if (invite.tenant_archived_at) {
      await client.query('ROLLBACK')
      return { error: conflict('Tenant is archived'), audit: denied('tenant_archived', inviteRef) }
    }

    const existing = await getMembership(client, user.id, invite.tenant_id)
    if (existing) {
      await client.query('ROLLBACK')
      return {
        error: conflict('Already a member of this tenant', { membership: existing }),
        audit: denied('already_member', inviteRef),
      }
    }

    await insertPendingMembership(client, user.id, invite.tenant_id, invite.role)
    await client.query('COMMIT')

    return {
      result: {
        tenant: { id: invite.tenant_id, slug: invite.tenant_slug, name: invite.tenant_name },
        role: invite.role,
        status: 'pending',
      },
      audit: { action: 'invite.redeem', details: { ...inviteRef, role: invite.role } },
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
