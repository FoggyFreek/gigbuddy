// Chart-of-accounts and accounting-settings domain logic. Route handlers stay
// thin and delegate here. Functions that can fail with a specific HTTP outcome
// return { error: { status, body } }; success returns a domain payload.
import pool from '../../db/index.js'
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import { notFound } from '../../platform/http/serviceErrors.js'
import { defaultReportingGroupForType } from '../../domain/accountReportingGroups.js'
import {
  validateAccountCreate,
  isValidCalendarDate,
  SETTINGS_TYPE_MAP,
  SETTINGS_CODE_FIELDS,
} from './accountValidators.js'
import {
  GUARDED_SETTINGS_FIELDS,
  acquireAccountingSettingsLock,
  checkOpenBalance,
  getSettings as getSettingsRow,
  listChartCodes,
  insertSettingsDefaults,
  insertSettings,
  updateSettings,
  findAccountByCode,
  listAccounts as listAccountRows,
  getAccountClassificationByCode,
  insertAccount,
  getAccountById,
  isCodeReferencedInSettings,
  updateAccountFields,
  deleteAccount as deleteAccountRow,
} from './accountRepository.js'
import { loadAccountingProfile } from '../accounting-profile/accountingProfileService.js'
import { bookkeepingCurrency } from '../../../shared/accountingProfileCodes.js'
import { findVatControlAccountConflict } from '../../../shared/vatControlAccounts.js'
import { accountBalance } from '../ledger/ledgerRepository.js'

const NOT_FOUND = notFound('not_found')

// Smart defaults for a missing settings row: codes that still exist in the
// tenant's chart (do NOT re-seed accounts, an admin may have deleted them).
const DEFAULT_CODES = {
  receivable_account_code: '11200',
  default_revenue_account_code: '41000',
  payable_account_code: '21100',
  default_reimbursement_account_code: '22000',
  default_expense_account_code: '61200',
  primary_checking_account_code: '11000',
  cash_account_code: '11100',
  output_vat_account_code: '24000',
  input_vat_account_code: '15000',
  vat_receivable_settlement_account_code: '15010',
  vat_payable_settlement_account_code: '24010',
  merch_inventory_account_code: '12200',
  merch_revenue_account_code: '42000',
  merch_cogs_account_code: '51000',
  shopify_clearing_account_code: '11300',
  paypal_clearing_account_code: '11400',
  shopify_fee_expense_account_code: '64100',
}

// ---------- settings ----------

export async function getSettings(db, tenantId) {
  const profile = await loadAccountingProfile(db, tenantId)
  // Derived, not stored: the books' currency follows the profile.
  const currency = bookkeepingCurrency(profile.base_currency)
  const existing = await getSettingsRow(db, tenantId)
  if (existing) return { settings: { ...existing, currency } }

  // Backstop: settings row missing — insert with smart defaults.
  const existingCodes = new Set(await listChartCodes(db, tenantId))
  const defaults = {}
  for (const [field, code] of Object.entries(DEFAULT_CODES)) {
    defaults[field] = existingCodes.has(code) ? code : null
  }
  const inserted = await insertSettingsDefaults(db, tenantId, defaults)
  return { settings: { ...inserted, currency } }
}

// Validates a single settings account-code field, returning { error } on a bad
// reference/type or { value } (the trimmed code, or null to clear).
async function resolveSettingsCode(db, tenantId, field, val) {
  if (val === null || val === undefined) return { value: null }
  const code = String(val).trim()
  const account = await findAccountByCode(db, tenantId, code)
  if (!account?.is_active) {
    return { error: { status: 400, body: { error: 'unknown_account_code', field } } }
  }
  const expectedType = SETTINGS_TYPE_MAP[field]
  if (account.type !== expectedType) {
    return { error: { status: 400, body: { error: 'wrong_account_type', field, expected: expectedType, got: account.type } } }
  }
  return { value: code }
}

async function buildSettingsUpdates(db, tenantId, body) {
  const updates = {}

  if ('currency' in body) {
    return { error: { status: 400, body: { error: 'currency_read_only' } } }
  }

  for (const field of SETTINGS_CODE_FIELDS) {
    if (!(field in body)) continue
    const resolved = await resolveSettingsCode(db, tenantId, field, body[field])
    if (resolved.error) return resolved
    updates[field] = resolved.value
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
  for (const field of ['input_vat_account_code', 'output_vat_account_code']) {
    if (!(field in updates) || updates[field] === (current[field] ?? null)) continue
    const currentCode = current[field]
    if (currentCode && await accountBalance(client, tenantId, currentCode) !== 0) {
      return { field, reason: 'the current VAT control account has a non-zero balance' }
    }
  }
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

  return withTransaction(async (client) => {
    // Serialize against ledger postings (which take the same lock via
    // loadAccountingSettings), then refuse to move an account code that still
    // carries an open balance.
    await acquireAccountingSettingsLock(client, tenantId)
    const profile = await loadAccountingProfile(client, tenantId)
    const current = (await getSettingsRow(client, tenantId)) || {}

    const roleConflict = findVatControlAccountConflict({ ...current, ...updates })
    if (roleConflict) {
      abortTransaction({
        error: {
          status: 400,
          body: {
            error: 'A VAT control account cannot be assigned to another accounting role',
            code: 'vat_control_account_conflict',
            field: roleConflict.field,
            conflicting_field: roleConflict.conflictingField,
            account_code: roleConflict.accountCode,
          },
        },
      })
    }

    const conflict = await findOpenBalanceConflict(client, tenantId, updates, current)
    if (conflict) {
      abortTransaction({
        error: {
          status: 409,
          body: {
            error: `Cannot change ${conflict.field}: ${conflict.reason}. Settle them first.`,
            code: 'account_has_open_balance',
            field: conflict.field,
          },
        },
      })
    }

    const currency = bookkeepingCurrency(profile.base_currency)
    const updated = await updateSettings(client, tenantId, updates)
    if (!updated) {
      // Row didn't exist — insert it with the updates applied as defaults
      const full = {
        receivable_account_code: null,
        default_revenue_account_code: null,
        payable_account_code: null,
        default_reimbursement_account_code: null,
        default_expense_account_code: null,
        primary_checking_account_code: null,
        cash_account_code: null,
        output_vat_account_code: null,
        input_vat_account_code: null,
        vat_receivable_settlement_account_code: null,
        vat_payable_settlement_account_code: null,
        merch_inventory_account_code: null,
        merch_revenue_account_code: null,
        merch_cogs_account_code: null,
        shopify_clearing_account_code: null,
        paypal_clearing_account_code: null,
        shopify_fee_expense_account_code: null,
        books_closed_through: null,
        ...updates,
      }
      const inserted = await insertSettings(client, tenantId, full)
      return { settings: { ...inserted, currency } }
    }
    return { settings: { ...updated, currency } }
  })
}

// ---------- chart of accounts ----------

export async function listAccounts(db, tenantId) {
  return listAccountRows(db, tenantId)
}

export async function createAccount(db, tenantId, body = {}) {
  const validated = validateAccountCreate(body)
  if (validated.error) return { error: { status: 400, body: { error: validated.error } } }

  const { code, name, type, parent_code, is_capitalizable } = validated
  let reportingGroup = defaultReportingGroupForType(type)

  if (parent_code) {
    const parent = await getAccountClassificationByCode(db, tenantId, parent_code)
    if (!parent) return { error: { status: 400, body: { error: 'parent_not_found' } } }
    if (parent.type !== type) {
      return { error: { status: 400, body: { error: 'type_mismatch_with_parent' } } }
    }
    reportingGroup = parent.reporting_group
  }

  try {
    const account = await insertAccount(db, tenantId, {
      code, name, type, parent_code, reporting_group: reportingGroup, is_capitalizable,
    })
    return { account }
  } catch (err) {
    if (err.code === '23505') return { error: { status: 409, body: { error: 'code_taken' } } }
    throw err
  }
}

// Resolves an is_active change, guarding against deactivating an account still
// referenced by settings. Returns { error } or { value }.
async function resolveActiveUpdate(db, tenantId, existing, rawIsActive) {
  const isActive = Boolean(rawIsActive)
  if (!isActive) {
    const referenced = await isCodeReferencedInSettings(db, tenantId, existing.code)
    if (referenced) {
      return { error: { status: 409, body: { error: 'account_in_use' } } }
    }
  }
  return { value: isActive }
}

export async function patchAccount(db, tenantId, id, body = {}) {
  const existing = await getAccountById(db, tenantId, id)
  if (!existing) return NOT_FOUND

  const updates = {}

  // A null name clears the override and restores the country default. It has to
  // be handled before the trim below, which would read null as an empty name.
  // Only seeded accounts have a default worth returning to.
  if ('name' in body) {
    if (body.name === null) {
      if (!existing.is_system) {
        return { error: { status: 409, body: { error: 'not_system_account' } } }
      }
      updates.name = existing.default_name
      updates.name_is_customized = false
    } else {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return { error: { status: 400, body: { error: 'name_required' } } }
      updates.name = name
      updates.name_is_customized = true
    }
  }

  if ('is_active' in body) {
    const activeResult = await resolveActiveUpdate(db, tenantId, existing, body.is_active)
    if (activeResult.error) return activeResult
    updates.is_active = activeResult.value
  }

  if ('is_capitalizable' in body) {
    const isCapitalizable = Boolean(body.is_capitalizable)
    // Only asset accounts can be a capitalizable purchase target.
    if (isCapitalizable && existing.type !== 'asset') {
      return { error: { status: 400, body: { error: 'capitalizable_requires_asset' } } }
    }
    updates.is_capitalizable = isCapitalizable
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
