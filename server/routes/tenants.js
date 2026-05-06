import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

function validSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug)
}

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*,
              (SELECT COUNT(*)::int FROM memberships m
                 WHERE m.tenant_id = t.id AND m.status = 'approved') AS member_count
         FROM tenants t
        ORDER BY t.id`,
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id)
  try {
    const { rows } = await pool.query('SELECT * FROM tenants WHERE id = $1', [id])
    if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' })
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  const { slug, band_name } = req.body || {}
  if (!validSlug(slug)) return res.status(400).json({ error: 'Invalid slug' })
  if (!band_name || typeof band_name !== 'string') {
    return res.status(400).json({ error: 'band_name is required' })
  }
  // Default the seed admin to the creating super admin so the new tenant is
  // immediately usable. Pass `adminUserId` to assign someone else; pass `null`
  // to skip (creating an unreachable tenant — only useful for tooling).
  const hasAdminUserIdField = req.body && Object.prototype.hasOwnProperty.call(req.body, 'adminUserId')
  let adminUserId = hasAdminUserIdField ? req.body.adminUserId : req.user.id
  if (adminUserId !== null && adminUserId !== undefined) {
    adminUserId = Number(adminUserId)
    if (!Number.isInteger(adminUserId) || adminUserId <= 0) {
      return res.status(400).json({ error: 'adminUserId must be an integer or null' })
    }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (adminUserId) {
      const { rows: u } = await client.query('SELECT id FROM users WHERE id = $1', [adminUserId])
      if (!u[0]) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'adminUserId references a non-existent user' })
      }
    }

    const { rows } = await client.query(
      `INSERT INTO tenants (slug, band_name, created_by_user_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [slug, band_name, req.user.id],
    )
    const tenant = rows[0]

    if (adminUserId) {
      await client.query(
        `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, approved_by_user_id)
         VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), $3)`,
        [adminUserId, tenant.id, req.user.id],
      )
    }

    await client.query('COMMIT')
    res.status(201).json(tenant)
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Slug already in use' })
    }
    next(err)
  } finally {
    client.release()
  }
})

const PATCHABLE = [
  'slug',
  'band_name',
  'bio',
  'instagram_handle',
  'facebook_handle',
  'tiktok_handle',
  'youtube_handle',
  'spotify_handle',
  'logo_path',
]

router.patch('/:id', async (req, res, next) => {
  const id = Number(req.params.id)
  const sets = []
  const values = []
  let i = 1
  for (const key of PATCHABLE) {
    if (key in req.body) {
      if (key === 'slug' && !validSlug(req.body.slug)) {
        return res.status(400).json({ error: 'Invalid slug' })
      }
      sets.push(`${key} = $${i++}`)
      values.push(req.body[key])
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' })
  sets.push(`updated_at = NOW()`)
  values.push(id)

  try {
    const { rows } = await pool.query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    )
    if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' })
    res.json(rows[0])
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Slug already in use' })
    }
    next(err)
  }
})

router.post('/:id/admins', async (req, res, next) => {
  const tenantId = Number(req.params.id)
  const userId = Number(req.body?.userId)
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: 'userId is required' })
  }
  try {
    const { rows: tRows } = await pool.query('SELECT id FROM tenants WHERE id = $1', [tenantId])
    if (!tRows[0]) return res.status(404).json({ error: 'Tenant not found' })
    const { rows: uRows } = await pool.query('SELECT id FROM users WHERE id = $1', [userId])
    if (!uRows[0]) return res.status(404).json({ error: 'User not found' })

    const { rows } = await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, approved_by_user_id)
       VALUES ($1, $2, 'tenant_admin', 'approved', NOW(), $3)
       ON CONFLICT (user_id, tenant_id)
       DO UPDATE SET role = 'tenant_admin',
                     status = 'approved',
                     approved_at = NOW(),
                     approved_by_user_id = EXCLUDED.approved_by_user_id
       RETURNING *`,
      [userId, tenantId, req.user.id],
    )
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
})

// Super-admin direct grant: upsert an approved membership in any tenant
// without requiring the user to redeem an invite. `role` defaults to 'member'.
router.post('/:id/memberships', async (req, res, next) => {
  const tenantId = Number(req.params.id)
  const userId = Number(req.body?.userId)
  const role = req.body?.role ?? 'member'
  if (!Number.isInteger(userId)) {
    return res.status(400).json({ error: 'userId is required' })
  }
  if (role !== 'member' && role !== 'tenant_admin') {
    return res.status(400).json({ error: 'Invalid role' })
  }
  try {
    const { rows: tRows } = await pool.query(
      'SELECT id, archived_at FROM tenants WHERE id = $1',
      [tenantId],
    )
    if (!tRows[0]) return res.status(404).json({ error: 'Tenant not found' })
    if (tRows[0].archived_at) return res.status(409).json({ error: 'Tenant is archived' })

    const { rows: uRows } = await pool.query('SELECT id FROM users WHERE id = $1', [userId])
    if (!uRows[0]) return res.status(404).json({ error: 'User not found' })

    const { rows } = await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status, approved_at, approved_by_user_id)
       VALUES ($1, $2, $3, 'approved', NOW(), $4)
       ON CONFLICT (user_id, tenant_id)
       DO UPDATE SET role = EXCLUDED.role,
                     status = 'approved',
                     approved_at = NOW(),
                     approved_by_user_id = EXCLUDED.approved_by_user_id
       RETURNING *`,
      [userId, tenantId, role, req.user.id],
    )
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
})

router.delete('/:id/admins/:userId', async (req, res, next) => {
  const tenantId = Number(req.params.id)
  const userId = Number(req.params.userId)
  try {
    const { rowCount } = await pool.query(
      `UPDATE memberships SET role = 'member'
        WHERE tenant_id = $1 AND user_id = $2 AND role = 'tenant_admin'`,
      [tenantId, userId],
    )
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Tenant admin membership not found' })
    }
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

router.post('/:id/archive', async (req, res, next) => {
  const id = Number(req.params.id)
  try {
    const { rows } = await pool.query(
      `UPDATE tenants SET archived_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' })
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

router.post('/:id/unarchive', async (req, res, next) => {
  const id = Number(req.params.id)
  try {
    const { rows } = await pool.query(
      `UPDATE tenants SET archived_at = NULL, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id],
    )
    if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' })
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

export default router
