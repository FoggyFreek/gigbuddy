import { Router } from 'express'
import pool from '../db/index.js'
import { requireTenantAdmin } from '../middleware/tenant.js'
import {
  parseId,
  validateAccountCreate,
  validateCurrency,
  SETTINGS_TYPE_MAP,
  SETTINGS_CODE_FIELDS,
} from '../validators/accountValidators.js'

const router = Router()

// ---------- GET /api/accounts/settings ----------
// Must be declared before /:id so Express doesn't treat "settings" as an id.
router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM tenant_accounting_settings WHERE tenant_id = $1',
      [req.tenantId],
    )

    if (rows[0]) return res.json(rows[0])

    // Backstop: settings row missing — insert with smart defaults (codes that still
    // exist in the tenant's chart; do NOT re-seed accounts, an admin may have deleted them).
    const { rows: coa } = await pool.query(
      'SELECT code FROM chart_of_accounts WHERE tenant_id = $1',
      [req.tenantId],
    )
    const existingCodes = new Set(coa.map((r) => r.code))
    const defaults = {
      currency: 'EUR',
      receivable_account_code: existingCodes.has('11200') ? '11200' : null,
      default_revenue_account_code: existingCodes.has('41000') ? '41000' : null,
      payable_account_code: existingCodes.has('21100') ? '21100' : null,
      default_expense_account_code: existingCodes.has('61200') ? '61200' : null,
      primary_checking_account_code: existingCodes.has('11000') ? '11000' : null,
      output_vat_account_code: existingCodes.has('24000') ? '24000' : null,
      input_vat_account_code: existingCodes.has('15000') ? '15000' : null,
    }
    const { rows: inserted } = await pool.query(
      `INSERT INTO tenant_accounting_settings (
         tenant_id, currency,
         receivable_account_code, default_revenue_account_code,
         payable_account_code, default_expense_account_code,
         primary_checking_account_code,
         output_vat_account_code, input_vat_account_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [
        req.tenantId,
        defaults.currency,
        defaults.receivable_account_code,
        defaults.default_revenue_account_code,
        defaults.payable_account_code,
        defaults.default_expense_account_code,
        defaults.primary_checking_account_code,
        defaults.output_vat_account_code,
        defaults.input_vat_account_code,
      ],
    )
    res.json(inserted[0])
  } catch (err) {
    next(err)
  }
})

// ---------- PATCH /api/accounts/settings ----------
router.patch('/settings', requireTenantAdmin, async (req, res, next) => {
  const body = req.body || {}
  const updates = {}

  if ('currency' in body) {
    const c = validateCurrency(body.currency)
    if (!c) return res.status(400).json({ error: 'invalid_currency' })
    updates.currency = c
  }

  for (const field of SETTINGS_CODE_FIELDS) {
    if (!(field in body)) continue
    const val = body[field]
    if (val === null || val === undefined) {
      updates[field] = null
      continue
    }
    const code = String(val).trim()
    const { rows } = await pool.query(
      `SELECT code, type, is_active FROM chart_of_accounts
       WHERE tenant_id = $1 AND code = $2`,
      [req.tenantId, code],
    )
    if (!rows[0] || !rows[0].is_active) {
      return res.status(400).json({ error: 'unknown_account_code', field })
    }
    const expectedType = SETTINGS_TYPE_MAP[field]
    if (rows[0].type !== expectedType) {
      return res.status(400).json({ error: 'wrong_account_type', field, expected: expectedType, got: rows[0].type })
    }
    updates[field] = code
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'nothing_to_update' })
  }

  const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`)
  sets.push('updated_at = NOW()')
  const values = [req.tenantId, ...Object.values(updates)]

  try {
    const { rows } = await pool.query(
      `UPDATE tenant_accounting_settings SET ${sets.join(', ')} WHERE tenant_id = $1 RETURNING *`,
      values,
    )
    if (!rows[0]) {
      // Row didn't exist — insert it with the updates applied as defaults
      const full = {
        currency: 'EUR',
        receivable_account_code: null,
        default_revenue_account_code: null,
        payable_account_code: null,
        default_expense_account_code: null,
        primary_checking_account_code: null,
        output_vat_account_code: null,
        input_vat_account_code: null,
        ...updates,
      }
      const { rows: ins } = await pool.query(
        `INSERT INTO tenant_accounting_settings (
           tenant_id, currency,
           receivable_account_code, default_revenue_account_code,
           payable_account_code, default_expense_account_code,
           primary_checking_account_code,
           output_vat_account_code, input_vat_account_code
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          req.tenantId, full.currency,
          full.receivable_account_code, full.default_revenue_account_code,
          full.payable_account_code, full.default_expense_account_code,
          full.primary_checking_account_code,
          full.output_vat_account_code, full.input_vat_account_code,
        ],
      )
      return res.json(ins[0])
    }
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

// ---------- GET /api/accounts ----------
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM chart_of_accounts WHERE tenant_id = $1 ORDER BY code`,
      [req.tenantId],
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// ---------- POST /api/accounts ----------
router.post('/', requireTenantAdmin, async (req, res, next) => {
  const validated = validateAccountCreate(req.body || {})
  if (validated.error) return res.status(400).json({ error: validated.error })

  const { code, name, type, parent_code } = validated

  if (parent_code) {
    const { rows } = await pool.query(
      'SELECT type FROM chart_of_accounts WHERE tenant_id = $1 AND code = $2',
      [req.tenantId, parent_code],
    )
    if (!rows[0]) return res.status(400).json({ error: 'parent_not_found' })
    if (rows[0].type !== type) {
      return res.status(400).json({ error: 'type_mismatch_with_parent' })
    }
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
       VALUES ($1, $2, $3, $4, $5, false) RETURNING *`,
      [req.tenantId, code, name, type, parent_code],
    )
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'code_taken' })
    next(err)
  }
})

// ---------- PATCH /api/accounts/:id ----------
router.patch('/:id', requireTenantAdmin, async (req, res, next) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'invalid_id' })

  const { rows: existing } = await pool.query(
    'SELECT id, code FROM chart_of_accounts WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!existing[0]) return res.status(404).json({ error: 'not_found' })

  const body = req.body || {}
  const updates = {}

  if ('name' in body) {
    const name = String(body.name ?? '').trim()
    if (!name) return res.status(400).json({ error: 'name_required' })
    updates.name = name
  }

  if ('is_active' in body) {
    const isActive = Boolean(body.is_active)
    if (!isActive) {
      // Guard: cannot deactivate an account referenced by settings
      const code = existing[0].code
      const { rows: refRows } = await pool.query(
        `SELECT tenant_id FROM tenant_accounting_settings
         WHERE tenant_id = $1 AND (
           receivable_account_code = $2 OR
           default_revenue_account_code = $2 OR
           payable_account_code = $2 OR
           default_expense_account_code = $2 OR
           primary_checking_account_code = $2 OR
           output_vat_account_code = $2 OR
           input_vat_account_code = $2
         )`,
        [req.tenantId, code],
      )
      if (refRows.length > 0) {
        return res.status(409).json({ error: 'account_in_use' })
      }
    }
    updates.is_active = isActive
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'nothing_to_update' })
  }

  const setClauses = []
  const values = []
  for (const [k, v] of Object.entries(updates)) {
    setClauses.push(`${k} = $${values.length + 1}`)
    values.push(v)
  }
  setClauses.push('updated_at = NOW()')
  const idIdx = values.length + 1
  const tenantIdx = values.length + 2
  values.push(id, req.tenantId)

  try {
    const { rows } = await pool.query(
      `UPDATE chart_of_accounts SET ${setClauses.join(', ')} WHERE id = $${idIdx} AND tenant_id = $${tenantIdx} RETURNING *`,
      values,
    )
    if (!rows[0]) return res.status(404).json({ error: 'not_found' })
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

// ---------- DELETE /api/accounts/:id ----------
router.delete('/:id', requireTenantAdmin, async (req, res, next) => {
  const id = parseId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'invalid_id' })

  const { rows } = await pool.query(
    'SELECT id FROM chart_of_accounts WHERE id = $1 AND tenant_id = $2',
    [id, req.tenantId],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not_found' })

  try {
    await pool.query(
      'DELETE FROM chart_of_accounts WHERE id = $1 AND tenant_id = $2',
      [id, req.tenantId],
    )
    res.status(204).end()
  } catch (err) {
    if (err.code === '23503') return res.status(409).json({ error: 'account_in_use' })
    next(err)
  }
})

export default router
