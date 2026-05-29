import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'

const router = Router()

const ALLOWED_STATUS = new Set(['pending', 'approved', 'rejected'])
const ALLOWED_ROLE = new Set(['member', 'tenant_admin'])

function parseId(val) {
  const n = Number(val)
  return Number.isInteger(n) && n > 0 ? n : null
}

function requireUserId(req, res) {
  const id = parseId(req.params.userId)
  if (id === null) {
    res.status(400).json({ error: 'Invalid userId' })
    return null
  }
  return id
}

// Atomically points the user at a band member: validates (and locks) the target
// before clearing the old link, so a missing target can't leave the user
// unlinked. Returns { error } | {}.
async function reassignBandMember(tenantId, userId, bandMemberId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (bandMemberId !== null) {
      const { rows } = await client.query(
        'SELECT user_id FROM band_members WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [bandMemberId, tenantId],
      )
      if (!rows.length) {
        await client.query('ROLLBACK')
        return { error: { status: 404, body: { error: 'Band member not found in this tenant' } } }
      }
    }

    // Clear the user's current link, then assign the new one (if any).
    await client.query(
      'UPDATE band_members SET user_id = NULL WHERE user_id = $1 AND tenant_id = $2',
      [userId, tenantId],
    )
    if (bandMemberId !== null) {
      await client.query(
        'UPDATE band_members SET user_id = $1 WHERE id = $2 AND tenant_id = $3',
        [userId, bandMemberId, tenantId],
      )
    }

    await client.query('COMMIT')
    return {}
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id              AS membership_id,
              m.role,
              m.status,
              m.created_at      AS membership_created_at,
              m.approved_at,
              u.id               AS user_id,
              u.email,
              u.name,
              u.picture_url,
              u.is_super_admin,
              bm.id              AS band_member_id
         FROM memberships m
         JOIN users u            ON u.id = m.user_id
         LEFT JOIN band_members bm
           ON bm.user_id = u.id AND bm.tenant_id = m.tenant_id
        WHERE m.tenant_id = $1
        ORDER BY
          CASE m.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
          m.created_at`,
      [req.tenantId],
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

async function readMembershipRow(tenantId, userId) {
  const { rows } = await pool.query(
    `SELECT m.id              AS membership_id,
            m.role,
            m.status,
            m.created_at      AS membership_created_at,
            m.approved_at,
            u.id               AS user_id,
            u.email,
            u.name,
            u.picture_url,
            u.is_super_admin,
            bm.id              AS band_member_id
       FROM memberships m
       JOIN users u            ON u.id = m.user_id
       LEFT JOIN band_members bm
         ON bm.user_id = u.id AND bm.tenant_id = m.tenant_id
      WHERE m.tenant_id = $1 AND m.user_id = $2`,
    [tenantId, userId],
  )
  return rows[0] || null
}

function validateMembershipPatch(status, role) {
  if (status !== undefined && !ALLOWED_STATUS.has(status)) {
    return { error: { status: 400, body: { error: 'Invalid status' } } }
  }
  if (role !== undefined && !ALLOWED_ROLE.has(role)) {
    return { error: { status: 400, body: { error: 'Invalid role' } } }
  }
  if (status === undefined && role === undefined) {
    return { error: { status: 400, body: { error: 'Nothing to update' } } }
  }
  return {}
}

// Privileged-change gates that need the existing membership row. Emits an audit
// entry and returns { status, body } on denial, or null when allowed.
function authorizeMembershipChange(req, { existing, status, role, callerIsSuperAdmin, userId }) {
  if (existing.is_super_admin && existing.user_id !== req.user.id && !callerIsSuperAdmin) {
    auditLog(req, 'membership.update.denied', { targetUserId: userId, reason: 'modify_super_admin' })
    return { status: 403, body: { error: 'Cannot modify a super admin membership' } }
  }
  if (existing.role === 'tenant_admin' && role !== undefined && role !== 'tenant_admin' && !callerIsSuperAdmin) {
    auditLog(req, 'membership.update.denied', { targetUserId: userId, role, reason: 'demote_tenant_admin_requires_super_admin' })
    return { status: 403, body: { error: 'Only super admins can demote a tenant_admin' } }
  }
  // Approving a pending tenant_admin membership is effectively a grant of
  // tenant_admin powers — gate it to super admins regardless of how the
  // pending row got there (invite redemption, manual seed, etc.).
  if (status === 'approved' && existing.role === 'tenant_admin' && existing.status !== 'approved' && !callerIsSuperAdmin) {
    auditLog(req, 'membership.update.denied', { targetUserId: userId, status, reason: 'approve_tenant_admin_requires_super_admin' })
    return { status: 403, body: { error: 'Only super admins can approve a tenant_admin membership' } }
  }
  return null
}

function buildMembershipUpdate({ status, role, approverUserId }) {
  const sets = []
  const values = []
  let i = 1
  if (status !== undefined) {
    sets.push(`status = $${i++}`)
    values.push(status)
    if (status === 'approved') {
      sets.push(`approved_at = NOW()`, `approved_by_user_id = $${i++}`)
      values.push(approverUserId)
    } else {
      sets.push(`approved_at = NULL`, `approved_by_user_id = NULL`)
    }
  }
  if (role !== undefined) {
    sets.push(`role = $${i++}`)
    values.push(role)
  }
  return { sets, values, nextIdx: i }
}

router.patch('/:userId/membership', async (req, res, next) => {
  const userId = requireUserId(req, res); if (userId === null) return
  const { status, role } = req.body
  const validation = validateMembershipPatch(status, role)
  if (validation.error) return res.status(validation.error.status).json(validation.error.body)

  const callerIsSuperAdmin = !!req.user?.is_super_admin
  if (role === 'tenant_admin' && !callerIsSuperAdmin) {
    auditLog(req, 'membership.update.denied', { targetUserId: userId, role, reason: 'grant_tenant_admin_requires_super_admin' })
    return res.status(403).json({ error: 'Only super admins can grant tenant_admin' })
  }

  try {
    const existing = await readMembershipRow(req.tenantId, userId)
    if (!existing) return res.status(404).json({ error: 'Membership not found' })

    const denied = authorizeMembershipChange(req, { existing, status, role, callerIsSuperAdmin, userId })
    if (denied) return res.status(denied.status).json(denied.body)

    const { sets, values, nextIdx } = buildMembershipUpdate({ status, role, approverUserId: req.user.id })
    values.push(req.tenantId, userId)
    await pool.query(
      `UPDATE memberships SET ${sets.join(', ')}
        WHERE tenant_id = $${nextIdx} AND user_id = $${nextIdx + 1}`,
      values,
    )

    const updated = await readMembershipRow(req.tenantId, userId)
    auditLog(req, 'membership.update', {
      targetUserId: userId,
      ...(status !== undefined && { status }),
      ...(role !== undefined && { role }),
    })
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

router.patch('/:userId/band-member', async (req, res, next) => {
  const userId = requireUserId(req, res); if (userId === null) return
  const { band_member_id } = req.body
  if (band_member_id !== null && !Number.isInteger(band_member_id)) {
    return res.status(400).json({ error: 'band_member_id must be an integer or null' })
  }

  try {
    const membership = await readMembershipRow(req.tenantId, userId)
    if (!membership) return res.status(404).json({ error: 'Membership not found' })

    const result = await reassignBandMember(req.tenantId, userId, band_member_id)
    if (result.error) return res.status(result.error.status).json(result.error.body)

    const updated = await readMembershipRow(req.tenantId, userId)
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

router.delete('/:userId', async (req, res, next) => {
  const userId = requireUserId(req, res); if (userId === null) return
  const callerIsSuperAdmin = !!req.user?.is_super_admin
  try {
    const existing = await readMembershipRow(req.tenantId, userId)
    if (!existing) return res.status(404).json({ error: 'Membership not found' })
    if (existing.is_super_admin && !callerIsSuperAdmin) {
      auditLog(req, 'membership.remove.denied', { targetUserId: userId, reason: 'remove_super_admin' })
      return res.status(403).json({ error: 'Cannot remove a super admin membership' })
    }
    if (
      existing.role === 'tenant_admin' &&
      existing.user_id !== req.user.id &&
      !callerIsSuperAdmin
    ) {
      auditLog(req, 'membership.remove.denied', { targetUserId: userId, reason: 'remove_tenant_admin_requires_super_admin' })
      return res.status(403).json({ error: 'Only super admins can remove a tenant_admin' })
    }
    await pool.query(
      `UPDATE band_members SET user_id = NULL
        WHERE user_id = $1 AND tenant_id = $2`,
      [userId, req.tenantId],
    )
    await pool.query(
      `DELETE FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
      [req.tenantId, userId],
    )
    auditLog(req, 'membership.remove', { targetUserId: userId })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export default router
