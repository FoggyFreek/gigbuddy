import { Router } from 'express'
import { randomBytes } from 'crypto'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'

export const adminRouter = Router()
export const redeemRouter = Router()

const ALLOWED_ROLES = new Set(['member', 'tenant_admin'])

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

adminRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*,
              cu.name AS created_by_name,
              uu.name AS used_by_name
         FROM tenant_invites i
         LEFT JOIN users cu ON cu.id = i.created_by_user_id
         LEFT JOIN users uu ON uu.id = i.used_by_user_id
        WHERE i.tenant_id = $1
        ORDER BY i.created_at DESC`,
      [req.tenantId],
    )
    res.json(rows.map(shapeInvite))
  } catch (err) {
    next(err)
  }
})

adminRouter.post('/', async (req, res, next) => {
  const role = req.body?.role ?? 'member'
  const expiresInDays = req.body?.expiresInDays
  if (!ALLOWED_ROLES.has(role)) {
    return res.status(400).json({ error: 'Invalid role' })
  }
  if (role === 'tenant_admin' && !req.user?.is_super_admin) {
    return res.status(403).json({ error: 'Only super admins can issue tenant_admin invites' })
  }
  let expiresAt = null
  if (expiresInDays !== undefined && expiresInDays !== null) {
    const days = Number(expiresInDays)
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      return res.status(400).json({ error: 'expiresInDays must be a positive number ≤ 365' })
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  }

  try {
    const code = generateCode()
    const { rows } = await pool.query(
      `INSERT INTO tenant_invites (code, tenant_id, role, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [code, req.tenantId, role, req.user.id, expiresAt],
    )
    auditLog(req, 'invite.create', { inviteId: rows[0].id, role, expiresAt })
    res.status(201).json(shapeInvite(rows[0]))
  } catch (err) {
    next(err)
  }
})

adminRouter.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' })
  }
  try {
    const { rowCount } = await pool.query(
      `UPDATE tenant_invites
          SET expires_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND used_at IS NULL`,
      [id, req.tenantId],
    )
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Invite not found' })
    }
    auditLog(req, 'invite.revoke', { inviteId: id })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

redeemRouter.post('/', async (req, res, next) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
  if (!code) {
    auditLog(req, 'invite.redeem.denied', { reason: 'missing_code' })
    return res.status(400).json({ error: 'code is required' })
  }
  if (req.user?.status === 'rejected') {
    auditLog(req, 'invite.redeem.denied', { reason: 'rejected_user' })
    return res.status(403).json({ error: 'Account is not allowed to redeem invites' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: invites } = await client.query(
      `UPDATE tenant_invites i
          SET used_at = NOW(),
              used_by_user_id = $2
         FROM tenants t
        WHERE i.code = $1
          AND i.used_at IS NULL
          AND t.id = i.tenant_id
        RETURNING i.*, t.slug AS tenant_slug, t.band_name AS tenant_name, t.archived_at AS tenant_archived_at`,
      [code, req.user.id],
    )
    const invite = invites[0]
    if (!invite) {
      const { rows: existingInvites } = await client.query(
        'SELECT used_at FROM tenant_invites WHERE code = $1',
        [code],
      )
      await client.query('ROLLBACK')
      if (!existingInvites[0]) {
        auditLog(req, 'invite.redeem.denied', { reason: 'not_found' })
        return res.status(404).json({ error: 'Invite not found' })
      }
      auditLog(req, 'invite.redeem.denied', { reason: 'already_used' })
      return res.status(409).json({ error: 'Invite already used' })
    }
    if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
      await client.query('ROLLBACK')
      auditLog(req, 'invite.redeem.denied', { tenantId: invite.tenant_id, inviteId: invite.id, reason: 'expired' })
      return res.status(410).json({ error: 'Invite has expired' })
    }
    if (invite.tenant_archived_at) {
      await client.query('ROLLBACK')
      auditLog(req, 'invite.redeem.denied', { tenantId: invite.tenant_id, inviteId: invite.id, reason: 'tenant_archived' })
      return res.status(409).json({ error: 'Tenant is archived' })
    }

    const { rows: existingMembership } = await client.query(
      `SELECT id, status, role FROM memberships WHERE user_id = $1 AND tenant_id = $2`,
      [req.user.id, invite.tenant_id],
    )
    if (existingMembership[0]) {
      await client.query('ROLLBACK')
      auditLog(req, 'invite.redeem.denied', {
        tenantId: invite.tenant_id,
        inviteId: invite.id,
        reason: 'already_member',
      })
      return res.status(409).json({
        error: 'Already a member of this tenant',
        membership: existingMembership[0],
      })
    }

    await client.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status)
       VALUES ($1, $2, $3, 'pending')`,
      [req.user.id, invite.tenant_id, invite.role],
    )

    await client.query('COMMIT')

    auditLog(req, 'invite.redeem', {
      tenantId: invite.tenant_id,
      inviteId: invite.id,
      role: invite.role,
    })
    res.status(201).json({
      tenant: {
        id: invite.tenant_id,
        slug: invite.tenant_slug,
        name: invite.tenant_name,
      },
      role: invite.role,
      status: 'pending',
    })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
})

export default { adminRouter, redeemRouter }
