import { Router } from 'express'
import pool from '../db/index.js'
import { requireTenantAdmin } from '../middleware/tenant.js'
import { acquireAccountingSettingsLock } from '../services/ledgerService.js'
import {
  parseId,
  validateAccountCreate,
  validateCurrency,
  isValidCalendarDate,
  SETTINGS_TYPE_MAP,
  SETTINGS_CODE_FIELDS,
} from '../validators/accountValidators.js'

const router = Router()

// Changing these account codes while a balance is still open on the current
// account would orphan that balance: postings already made (payable accrual,
// member-paid reimbursement liability, receivable on sent invoices) would sit
// on the old account while the clearing legs land on the new one. The check
// runs inside a transaction holding the per-tenant accounting settings advisory
// lock, so it serializes against in-flight postings.
const OPEN_BALANCE_GUARDS = {
  payable_account_code: {
    sql: `SELECT 1 FROM purchases WHERE tenant_id = $1 AND status = 'approved' LIMIT 1`,
    reason: 'approved unpaid purchases exist',
  },
  default_reimbursement_account_code: {
    sql: `SELECT 1 FROM purchases
           WHERE tenant_id = $1 AND payment_method = 'member' AND status = 'paid'
             AND reimbursement_id IS NULL LIMIT 1`,
    reason: 'outstanding member-paid purchases exist',
  },
  receivable_account_code: {
    sql: `SELECT 1 FROM invoices WHERE tenant_id = $1 AND status = 'sent' LIMIT 1`,
    reason: 'sent unpaid invoices exist',
  },
}

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
      default_reimbursement_account_code: existingCodes.has('22000') ? '22000' : null,
      default_expense_account_code: existingCodes.has('61200') ? '61200' : null,
      primary_checking_account_code: existingCodes.has('11000') ? '11000' : null,
      output_vat_account_code: existingCodes.has('24000') ? '24000' : null,
      input_vat_account_code: existingCodes.has('15000') ? '15000' : null,
      vat_receivable_settlement_account_code: existingCodes.has('15010') ? '15010' : null,
      vat_payable_settlement_account_code: existingCodes.has('24010') ? '24010' : null,
    }
    const { rows: inserted } = await pool.query(
      `INSERT INTO tenant_accounting_settings (
         tenant_id, currency,
         receivable_account_code, default_revenue_account_code,
         payable_account_code, default_reimbursement_account_code, default_expense_account_code,
         primary_checking_account_code,
         output_vat_account_code, input_vat_account_code,
         vat_receivable_settlement_account_code, vat_payable_settlement_account_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [
        req.tenantId,
        defaults.currency,
        defaults.receivable_account_code,
        defaults.default_revenue_account_code,
        defaults.payable_account_code,
        defaults.default_reimbursement_account_code,
        defaults.default_expense_account_code,
        defaults.primary_checking_account_code,
        defaults.output_vat_account_code,
        defaults.input_vat_account_code,
        defaults.vat_receivable_settlement_account_code,
        defaults.vat_payable_settlement_account_code,
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

  const updatesResult = await buildSettingsUpdates(pool, req.tenantId, body)
  if (updatesResult.error) return res.status(updatesResult.error.status).json(updatesResult.error.body)
  const { updates } = updatesResult

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'nothing_to_update' })
  }

  const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`)
  sets.push('updated_at = NOW()')
  const values = [req.tenantId, ...Object.values(updates)]

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Serialize against ledger postings (which take the same lock via
    // loadAccountingSettings), then refuse to move an account code that still
    // carries an open balance.
    await acquireAccountingSettingsLock(client, req.tenantId)
    const { rows: currentRows } = await client.query(
      'SELECT * FROM tenant_accounting_settings WHERE tenant_id = $1',
      [req.tenantId],
    )
    const current = currentRows[0] || {}

    const conflict = await findOpenBalanceConflict(client, req.tenantId, updates, current)
    if (conflict) {
      await client.query('ROLLBACK')
      return res.status(409).json({
        error: `Cannot change ${conflict.field}: ${conflict.reason}. Settle them first.`,
        code: 'account_has_open_balance',
        field: conflict.field,
      })
    }

    const { rows } = await client.query(
      `UPDATE tenant_accounting_settings SET ${sets.join(', ')} WHERE tenant_id = $1 RETURNING *`,
      values,
    )
    if (!rows[0]) {
      // Row didn't exist — insert it with the updates applied as defaults
      const ins = await insertSettingsWithDefaults(client, req.tenantId, updates)
      await client.query('COMMIT')
      return res.json(ins)
    }
    await client.query('COMMIT')
    res.json(rows[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    next(err)
  } finally {
    client.release()
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
           default_reimbursement_account_code = $2 OR
           default_expense_account_code = $2 OR
           primary_checking_account_code = $2 OR
           output_vat_account_code = $2 OR
           input_vat_account_code = $2 OR
           vat_receivable_settlement_account_code = $2 OR
           vat_payable_settlement_account_code = $2
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

async function buildSettingsUpdates(pool, tenantId, body) {
  const updates = {}

  if ('currency' in body) {
    const c = validateCurrency(body.currency)
    if (!c) return { error: { status: 400, body: { error: 'invalid_currency' } } }
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
      [tenantId, code],
    )
    if (!rows[0] || !rows[0].is_active) {
      return { error: { status: 400, body: { error: 'unknown_account_code', field } } }
    }
    const expectedType = SETTINGS_TYPE_MAP[field]
    if (rows[0].type !== expectedType) {
      return { error: { status: 400, body: { error: 'wrong_account_type', field, expected: expectedType, got: rows[0].type } } }
    }
    updates[field] = code
  }

  if ('books_closed_through' in body) {
    const val = body.books_closed_through
    if (val === null || val === undefined || val === '') {
      updates.books_closed_through = null
    } else if (isValidCalendarDate(val)) {
      updates.books_closed_through = val
    } else {
      return { error: { status: 400, body: { error: 'invalid_books_closed_through' } } }
    }
  }

  return { updates }
}

async function findOpenBalanceConflict(client, tenantId, updates, current) {
  for (const [field, guard] of Object.entries(OPEN_BALANCE_GUARDS)) {
    if (!(field in updates)) continue
    if (updates[field] === (current[field] ?? null)) continue
    const { rows: open } = await client.query(guard.sql, [tenantId])
    if (open.length) return { field, reason: guard.reason }
  }
  return null
}

async function insertSettingsWithDefaults(client, tenantId, updates) {
  const full = {
    currency: 'EUR',
    receivable_account_code: null,
    default_revenue_account_code: null,
    payable_account_code: null,
    default_reimbursement_account_code: null,
    default_expense_account_code: null,
    primary_checking_account_code: null,
    output_vat_account_code: null,
    input_vat_account_code: null,
    vat_receivable_settlement_account_code: null,
    vat_payable_settlement_account_code: null,
    books_closed_through: null,
    ...updates,
  }
  const { rows: ins } = await client.query(
    `INSERT INTO tenant_accounting_settings (
       tenant_id, currency,
       receivable_account_code, default_revenue_account_code,
       payable_account_code, default_reimbursement_account_code, default_expense_account_code,
       primary_checking_account_code,
       output_vat_account_code, input_vat_account_code,
       vat_receivable_settlement_account_code, vat_payable_settlement_account_code,
       books_closed_through
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [
      tenantId, full.currency,
      full.receivable_account_code, full.default_revenue_account_code,
      full.payable_account_code, full.default_reimbursement_account_code, full.default_expense_account_code,
      full.primary_checking_account_code,
      full.output_vat_account_code, full.input_vat_account_code,
      full.vat_receivable_settlement_account_code, full.vat_payable_settlement_account_code,
      full.books_closed_through,
    ],
  )
  return ins[0]
}

export default router
