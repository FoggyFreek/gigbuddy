// Chart-of-accounts and accounting-settings domain logic. Route handlers stay
// thin and delegate here. Functions that can fail with a specific HTTP outcome
// return { error: { status, body } }; success returns a domain payload.
import pool from '../db/index.js'
import { acquireAccountingSettingsLock } from './ledgerService.js'
import {
  validateAccountCreate,
  validateCurrency,
  isValidCalendarDate,
  SETTINGS_TYPE_MAP,
  SETTINGS_CODE_FIELDS,
} from '../validators/accountValidators.js'
import {
  GUARDED_SETTINGS_FIELDS,
  checkOpenBalance,
  getSettings as getSettingsRow,
  listChartCodes,
  insertSettingsDefaults,
  insertSettings,
  updateSettings,
  findAccountByCode,
  listAccounts as listAccountRows,
  getAccountTypeByCode,
  insertAccount,
  getAccountById,
  isCodeReferencedInSettings,
  updateAccountFields,
  deleteAccount as deleteAccountRow,
} from '../repositories/accountRepository.js'

const NOT_FOUND = { error: { status: 404, body: { error: 'not_found' } } }

// Smart defaults for a missing settings row: codes that still exist in the
// tenant's chart (do NOT re-seed accounts, an admin may have deleted them).
const DEFAULT_CODES = {
  receivable_account_code: '11200',
  default_revenue_account_code: '41000',
  payable_account_code: '21100',
  default_reimbursement_account_code: '22000',
  default_expense_account_code: '61200',
  primary_checking_account_code: '11000',
  output_vat_account_code: '24000',
  input_vat_account_code: '15000',
  vat_receivable_settlement_account_code: '15010',
  vat_payable_settlement_account_code: '24010',
  merch_inventory_account_code: '12200',
  merch_revenue_account_code: '42000',
  merch_cogs_account_code: '51000',
}

// ---------- settings ----------

export async function getSettings(db, tenantId) {
  const existing = await getSettingsRow(db, tenantId)
  if (existing) return { settings: existing }

  // Backstop: settings row missing — insert with smart defaults.
  const existingCodes = new Set(await listChartCodes(db, tenantId))
  const defaults = { currency: 'EUR' }
  for (const [field, code] of Object.entries(DEFAULT_CODES)) {
    defaults[field] = existingCodes.has(code) ? code : null
  }
  return { settings: await insertSettingsDefaults(db, tenantId, defaults) }
}

async function buildSettingsUpdates(db, tenantId, body) {
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
    const account = await findAccountByCode(db, tenantId, code)
    if (!account || !account.is_active) {
      return { error: { status: 400, body: { error: 'unknown_account_code', field } } }
    }
    const expectedType = SETTINGS_TYPE_MAP[field]
    if (account.type !== expectedType) {
      return { error: { status: 400, body: { error: 'wrong_account_type', field, expected: expectedType, got: account.type } } }
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
  for (const field of GUARDED_SETTINGS_FIELDS) {
    if (!(field in updates)) continue
    if (updates[field] === (current[field] ?? null)) continue
    const reason = await checkOpenBalance(client, tenantId, field)
    if (reason) return { field, reason }
  }
  return null
}

export async function patchSettings(tenantId, body = {}) {
  const updatesResult = await buildSettingsUpdates(pool, tenantId, body)
  if (updatesResult.error) return updatesResult
  const { updates } = updatesResult

  if (Object.keys(updates).length === 0) {
    return { error: { status: 400, body: { error: 'nothing_to_update' } } }
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Serialize against ledger postings (which take the same lock via
    // loadAccountingSettings), then refuse to move an account code that still
    // carries an open balance.
    await acquireAccountingSettingsLock(client, tenantId)
    const current = (await getSettingsRow(client, tenantId)) || {}

    const conflict = await findOpenBalanceConflict(client, tenantId, updates, current)
    if (conflict) {
      await client.query('ROLLBACK')
      return {
        error: {
          status: 409,
          body: {
            error: `Cannot change ${conflict.field}: ${conflict.reason}. Settle them first.`,
            code: 'account_has_open_balance',
            field: conflict.field,
          },
        },
      }
    }

    const updated = await updateSettings(client, tenantId, updates)
    if (!updated) {
      // Row didn't exist — insert it with the updates applied as defaults
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
        merch_inventory_account_code: null,
        merch_revenue_account_code: null,
        merch_cogs_account_code: null,
        books_closed_through: null,
        ...updates,
      }
      const inserted = await insertSettings(client, tenantId, full)
      await client.query('COMMIT')
      return { settings: inserted }
    }
    await client.query('COMMIT')
    return { settings: updated }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// ---------- chart of accounts ----------

export async function listAccounts(db, tenantId) {
  return listAccountRows(db, tenantId)
}

export async function createAccount(db, tenantId, body = {}) {
  const validated = validateAccountCreate(body)
  if (validated.error) return { error: { status: 400, body: { error: validated.error } } }

  const { code, name, type, parent_code } = validated

  if (parent_code) {
    const parentType = await getAccountTypeByCode(db, tenantId, parent_code)
    if (!parentType) return { error: { status: 400, body: { error: 'parent_not_found' } } }
    if (parentType !== type) {
      return { error: { status: 400, body: { error: 'type_mismatch_with_parent' } } }
    }
  }

  try {
    const account = await insertAccount(db, tenantId, { code, name, type, parent_code })
    return { account }
  } catch (err) {
    if (err.code === '23505') return { error: { status: 409, body: { error: 'code_taken' } } }
    throw err
  }
}

export async function patchAccount(db, tenantId, id, body = {}) {
  const existing = await getAccountById(db, tenantId, id)
  if (!existing) return NOT_FOUND

  const updates = {}

  if ('name' in body) {
    const name = String(body.name ?? '').trim()
    if (!name) return { error: { status: 400, body: { error: 'name_required' } } }
    updates.name = name
  }

  if ('is_active' in body) {
    const isActive = Boolean(body.is_active)
    if (!isActive) {
      // Guard: cannot deactivate an account referenced by settings
      const referenced = await isCodeReferencedInSettings(db, tenantId, existing.code)
      if (referenced) {
        return { error: { status: 409, body: { error: 'account_in_use' } } }
      }
    }
    updates.is_active = isActive
  }

  if (Object.keys(updates).length === 0) {
    return { error: { status: 400, body: { error: 'nothing_to_update' } } }
  }

  const account = await updateAccountFields(db, tenantId, id, updates)
  if (!account) return NOT_FOUND
  return { account }
}

export async function deleteAccount(db, tenantId, id) {
  const existing = await getAccountById(db, tenantId, id)
  if (!existing) return NOT_FOUND

  try {
    await deleteAccountRow(db, tenantId, id)
    return {}
  } catch (err) {
    if (err.code === '23503') return { error: { status: 409, body: { error: 'account_in_use' } } }
    throw err
  }
}
