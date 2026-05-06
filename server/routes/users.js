import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

const ALLOWED_STATUS = new Set(['pending', 'approved', 'rejected'])
const ALLOWED_ROLE = new Set(['member', 'tenant_admin'])

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

router.patch('/:userId/membership', async (req, res, next) => {
  const userId = Number(req.params.userId)
  const { status, role } = req.body
  if (status !== undefined && !ALLOWED_STATUS.has(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }
  if (role !== undefined && !ALLOWED_ROLE.has(role)) {
    return res.status(400).json({ error: 'Invalid role' })
  }
  if (status === undefined && role === undefined) {
    return res.status(400).json({ error: 'Nothing to update' })
  }
  const callerIsSuperAdmin = !!req.user?.is_super_admin
  if (role === 'tenant_admin' && !callerIsSuperAdmin) {
    return res.status(403).json({ error: 'Only super admins can grant tenant_admin' })
  }

  try {
    const existing = await readMembershipRow(req.tenantId, userId)
    if (!existing) return res.status(404).json({ error: 'Membership not found' })
    if (existing.is_super_admin && existing.user_id !== req.user.id && !callerIsSuperAdmin) {
      return res.status(403).json({ error: 'Cannot modify a super admin membership' })
    }
    if (
      existing.role === 'tenant_admin' &&
      role !== undefined &&
      role !== 'tenant_admin' &&
      !callerIsSuperAdmin
    ) {
      return res.status(403).json({ error: 'Only super admins can demote a tenant_admin' })
    }
    // Approving a pending tenant_admin membership is effectively a grant of
    // tenant_admin powers — gate it to super admins regardless of how the
    // pending row got there (invite redemption, manual seed, etc.).
    if (
      status === 'approved' &&
      existing.role === 'tenant_admin' &&
      existing.status !== 'approved' &&
      !callerIsSuperAdmin
    ) {
      return res.status(403).json({ error: 'Only super admins can approve a tenant_admin membership' })
    }

    const sets = []
    const values = []
    let i = 1
    if (status !== undefined) {
      sets.push(`status = $${i++}`)
      values.push(status)
      if (status === 'approved') {
        sets.push(`approved_at = NOW()`)
        sets.push(`approved_by_user_id = $${i++}`)
        values.push(req.user.id)
      } else {
        sets.push(`approved_at = NULL`)
        sets.push(`approved_by_user_id = NULL`)
      }
    }
    if (role !== undefined) {
      sets.push(`role = $${i++}`)
      values.push(role)
    }
    values.push(req.tenantId, userId)
    await pool.query(
      `UPDATE memberships SET ${sets.join(', ')}
        WHERE tenant_id = $${i++} AND user_id = $${i}`,
      values,
    )

    const updated = await readMembershipRow(req.tenantId, userId)
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

router.patch('/:userId/band-member', async (req, res, next) => {
  const userId = Number(req.params.userId)
  const { band_member_id } = req.body
  if (band_member_id !== null && !Number.isInteger(band_member_id)) {
    return res.status(400).json({ error: 'band_member_id must be an integer or null' })
  }

  try {
    const membership = await readMembershipRow(req.tenantId, userId)
    if (!membership) return res.status(404).json({ error: 'Membership not found' })

    await pool.query(
      `UPDATE band_members SET user_id = NULL
        WHERE user_id = $1 AND tenant_id = $2`,
      [userId, req.tenantId],
    )
    if (band_member_id !== null) {
      const { rowCount } = await pool.query(
        `UPDATE band_members SET user_id = $1
          WHERE id = $2 AND tenant_id = $3`,
        [userId, band_member_id, req.tenantId],
      )
      if (rowCount === 0) {
        return res.status(404).json({ error: 'Band member not found in this tenant' })
      }
    }

    const updated = await readMembershipRow(req.tenantId, userId)
    res.json(updated)
  } catch (err) {
    next(err)
  }
})

router.delete('/:userId', async (req, res, next) => {
  const userId = Number(req.params.userId)
  const callerIsSuperAdmin = !!req.user?.is_super_admin
  try {
    const existing = await readMembershipRow(req.tenantId, userId)
    if (!existing) return res.status(404).json({ error: 'Membership not found' })
    if (existing.is_super_admin && !callerIsSuperAdmin) {
      return res.status(403).json({ error: 'Cannot remove a super admin membership' })
    }
    if (
      existing.role === 'tenant_admin' &&
      existing.user_id !== req.user.id &&
      !callerIsSuperAdmin
    ) {
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
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

export default router
