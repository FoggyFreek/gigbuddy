// SQL for the chart of accounts and tenant accounting settings. No business
// decisions here; every function takes an executor (pool or transaction client)
// first so callers control transactions, and every query is tenant-scoped.

const SETTINGS_INSERT_COLUMNS = [
  'currency',
  'receivable_account_code', 'default_revenue_account_code',
  'payable_account_code', 'default_reimbursement_account_code', 'default_expense_account_code',
  'primary_checking_account_code',
  'output_vat_account_code', 'input_vat_account_code',
  'vat_receivable_settlement_account_code', 'vat_payable_settlement_account_code',
  'merch_inventory_account_code', 'merch_revenue_account_code', 'merch_cogs_account_code',
]

// Changing these account codes while a balance is still open on the current
// account would orphan that balance: postings already made (payable accrual,
// member-paid reimbursement liability, receivable on sent invoices) would sit
// on the old account while the clearing legs land on the new one.
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

export const GUARDED_SETTINGS_FIELDS = Object.keys(OPEN_BALANCE_GUARDS)

// Returns the human-readable reason if the guarded field still carries an open
// balance, or null when it's safe to change.
export async function checkOpenBalance(executor, tenantId, field) {
  const guard = OPEN_BALANCE_GUARDS[field]
  const { rows } = await executor.query(guard.sql, [tenantId])
  return rows.length ? guard.reason : null
}

export async function getSettings(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM tenant_accounting_settings WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0] || null
}

export async function listChartCodes(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT code FROM chart_of_accounts WHERE tenant_id = $1',
    [tenantId],
  )
  return rows.map((r) => r.code)
}

// Backstop insert when the settings row is missing on read. ON CONFLICT keeps a
// concurrent reader race harmless.
export async function insertSettingsDefaults(executor, tenantId, defaults) {
  const placeholders = SETTINGS_INSERT_COLUMNS.map((_, i) => `$${i + 2}`)
  const { rows } = await executor.query(
    `INSERT INTO tenant_accounting_settings (tenant_id, ${SETTINGS_INSERT_COLUMNS.join(', ')})
     VALUES ($1, ${placeholders.join(', ')})
     ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [tenantId, ...SETTINGS_INSERT_COLUMNS.map((c) => defaults[c])],
  )
  return rows[0]
}

export async function insertSettings(executor, tenantId, full) {
  const columns = [...SETTINGS_INSERT_COLUMNS, 'books_closed_through']
  const placeholders = columns.map((_, i) => `$${i + 2}`)
  const { rows } = await executor.query(
    `INSERT INTO tenant_accounting_settings (tenant_id, ${columns.join(', ')})
     VALUES ($1, ${placeholders.join(', ')}) RETURNING *`,
    [tenantId, ...columns.map((c) => full[c])],
  )
  return rows[0]
}

// `updates` keys are whitelisted by the service (validated settings fields only).
export async function updateSettings(executor, tenantId, updates) {
  const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`)
  sets.push('updated_at = NOW()')
  const { rows } = await executor.query(
    `UPDATE tenant_accounting_settings SET ${sets.join(', ')} WHERE tenant_id = $1 RETURNING *`,
    [tenantId, ...Object.values(updates)],
  )
  return rows[0] || null
}

export async function findAccountByCode(executor, tenantId, code) {
  const { rows } = await executor.query(
    `SELECT code, type, is_active FROM chart_of_accounts
     WHERE tenant_id = $1 AND code = $2`,
    [tenantId, code],
  )
  return rows[0] || null
}

export async function listAccounts(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM chart_of_accounts WHERE tenant_id = $1 ORDER BY code',
    [tenantId],
  )
  return rows
}

export async function getAccountTypeByCode(executor, tenantId, code) {
  const { rows } = await executor.query(
    'SELECT type FROM chart_of_accounts WHERE tenant_id = $1 AND code = $2',
    [tenantId, code],
  )
  return rows[0]?.type ?? null
}

export async function insertAccount(executor, tenantId, { code, name, type, parent_code }) {
  const { rows } = await executor.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, type, parent_code, is_system)
     VALUES ($1, $2, $3, $4, $5, false) RETURNING *`,
    [tenantId, code, name, type, parent_code],
  )
  return rows[0]
}

export async function getAccountById(executor, tenantId, id) {
  const { rows } = await executor.query(
    'SELECT id, code FROM chart_of_accounts WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  )
  return rows[0] || null
}

export async function isCodeReferencedInSettings(executor, tenantId, code) {
  const { rows } = await executor.query(
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
       vat_payable_settlement_account_code = $2 OR
       merch_inventory_account_code = $2 OR
       merch_revenue_account_code = $2 OR
       merch_cogs_account_code = $2
     )`,
    [tenantId, code],
  )
  return rows.length > 0
}

// `updates` keys are whitelisted by the service ('name' / 'is_active' only).
export async function updateAccountFields(executor, tenantId, id, updates) {
  const setClauses = []
  const values = []
  for (const [k, v] of Object.entries(updates)) {
    setClauses.push(`${k} = $${values.length + 1}`)
    values.push(v)
  }
  setClauses.push('updated_at = NOW()')
  const idIdx = values.length + 1
  const tenantIdx = values.length + 2
  values.push(id, tenantId)
  const { rows } = await executor.query(
    `UPDATE chart_of_accounts SET ${setClauses.join(', ')} WHERE id = $${idIdx} AND tenant_id = $${tenantIdx} RETURNING *`,
    values,
  )
  return rows[0] || null
}

export async function deleteAccount(executor, tenantId, id) {
  await executor.query(
    'DELETE FROM chart_of_accounts WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  )
}
