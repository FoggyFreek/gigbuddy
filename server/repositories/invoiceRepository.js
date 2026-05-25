// Data-access helpers for invoices. Each takes an `executor` (a pool or a
// transaction client) so callers control transaction boundaries.
import { formatInvoiceNumber } from '../validators/invoiceValidators.js'

export async function fetchTenant(executor, tenantId) {
  const { rows } = await executor.query('SELECT * FROM tenants WHERE id = $1', [tenantId])
  return rows[0] || null
}

export async function fetchInvoice(executor, tenantId, invoiceId) {
  const { rows } = await executor.query(
    'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2',
    [invoiceId, tenantId],
  )
  return rows[0] || null
}

export async function fetchLines(executor, invoiceId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, description, quantity, unit_price_cents, tax_percentage, position
       FROM invoice_lines
      WHERE invoice_id = $1 AND tenant_id = $2
      ORDER BY position ASC, id ASC`,
    [invoiceId, tenantId],
  )
  return rows
}

export async function nextInvoiceNumber(executor, tenantId, year) {
  const { rows } = await executor.query(
    `INSERT INTO invoice_number_sequences (tenant_id, year, next_seq)
     VALUES ($1, $2, 2)
     ON CONFLICT (tenant_id, year)
     DO UPDATE SET next_seq = invoice_number_sequences.next_seq + 1
     RETURNING next_seq - 1 AS seq`,
    [tenantId, year],
  )
  return formatInvoiceNumber(year, rows[0].seq)
}

export async function insertInvoiceLines(executor, invoiceId, tenantId, lines) {
  for (const line of lines) {
    await executor.query(
      `INSERT INTO invoice_lines (invoice_id, tenant_id, position, description, quantity, unit_price_cents, tax_percentage)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [invoiceId, tenantId, line.position, line.description, line.quantity, line.unit_price_cents, line.tax_percentage],
    )
  }
}

export async function replaceInvoiceLines(executor, invoiceId, tenantId, lines) {
  await executor.query(
    'DELETE FROM invoice_lines WHERE invoice_id = $1 AND tenant_id = $2',
    [invoiceId, tenantId],
  )
  await insertInvoiceLines(executor, invoiceId, tenantId, lines)
}

export async function validateGigIdForTenant(executor, rawGigId, tenantId) {
  const n = Number(rawGigId)
  if (!Number.isInteger(n) || n <= 0) return null
  const { rowCount } = await executor.query(
    'SELECT 1 FROM gigs WHERE id = $1 AND tenant_id = $2',
    [n, tenantId],
  )
  return rowCount ? n : null
}

// Drops the secret Mollie API key before a tenant row is returned to a client.
export function stripMollieKey(tenant) {
  if (!tenant) return tenant
  const safe = { ...tenant }
  delete safe.mollie_api_key
  return safe
}
