// Data-access helpers for invoices. Each takes an `executor` (a pool or a
// transaction client) so callers control transaction boundaries.
import { formatInvoiceNumber } from '../validators/invoiceValidators.js'

export async function fetchTenant(executor, tenantId) {
  const { rows } = await executor.query('SELECT * FROM tenants WHERE id = $1', [tenantId])
  return rows[0] || null
}

// `period` is the { sql, values } pair from buildPeriodWhere(query, 'issue_date').
export async function listInvoices(executor, tenantId, period) {
  const { rows } = await executor.query(
    `SELECT id, invoice_number, gig_id, issue_date, due_date,
            customer_name, total_cents, status, pdf_path, finalized_at,
            mollie_payment_link_id, mollie_payment_link_url,
            mollie_payment_status, mollie_paid_at,
            created_at, updated_at
       FROM invoices
      WHERE tenant_id = $1
        ${period.sql}
      ORDER BY issue_date DESC, id DESC`,
    [tenantId, ...period.values],
  )
  return rows
}

export async function listInvoicePeriodDates(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT DISTINCT to_char(issue_date, 'YYYY-MM-DD') AS date
       FROM invoices
      WHERE tenant_id = $1
        AND issue_date IS NOT NULL
      ORDER BY date DESC`,
    [tenantId],
  )
  return rows.map((row) => row.date)
}

export async function fetchGig(executor, tenantId, gigId) {
  const { rows } = await executor.query(
    'SELECT * FROM gigs WHERE id = $1 AND tenant_id = $2',
    [gigId, tenantId],
  )
  return rows[0] || null
}

export async function fetchVenue(executor, tenantId, venueId) {
  const { rows } = await executor.query(
    'SELECT * FROM venues WHERE id = $1 AND tenant_id = $2',
    [venueId, tenantId],
  )
  return rows[0] || null
}

export async function fetchInvoice(executor, tenantId, invoiceId) {
  const { rows } = await executor.query(
    'SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2',
    [invoiceId, tenantId],
  )
  return rows[0] || null
}

// Public (unauthenticated) lookups — gated on mollie_payment_link_id so only
// invoices shared for payment are reachable without a session, and not scoped to
// a tenant because the caller has no active tenant.

export async function fetchPublicInvoiceLogoPath(executor, invoiceId) {
  const { rows } = await executor.query(
    `SELECT t.logo_path
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
      WHERE i.id = $1 AND i.mollie_payment_link_id IS NOT NULL`,
    [invoiceId],
  )
  return rows[0]?.logo_path ?? null
}

export async function fetchInvoiceWithMollieKey(executor, invoiceId) {
  const { rows } = await executor.query(
    `SELECT i.*, t.mollie_api_key
       FROM invoices i
       JOIN tenants t ON t.id = i.tenant_id
      WHERE i.id = $1 AND i.mollie_payment_link_id IS NOT NULL`,
    [invoiceId],
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

// Inserts the invoice row. `invoice` is a flat object of column values; the
// caller computed totals and the invoice number. Returns the new id.
export async function insertInvoice(executor, invoice) {
  const { rows } = await executor.query(
    `INSERT INTO invoices (
       tenant_id, gig_id, invoice_number, issue_date, due_date, payment_term_days,
       customer_name, customer_contact_title, customer_contact_given_name, customer_contact_family_name,
       customer_address_street, customer_address_postal_code,
       customer_address_city, customer_address_country, customer_email,
       customer_kvk, customer_tax_id, memo, tax_inclusive,
       discount_type, discount_pct, discount_cents,
       invert_logo,
       subtotal_cents, tax_cents, total_cents,
       created_by_user_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10,
       $11, $12,
       $13, $14, $15,
       $16, $17, $18, $19,
       $20, $21, $22,
       $23,
       $24, $25, $26,
       $27
     ) RETURNING id`,
    [
      invoice.tenant_id, invoice.gig_id, invoice.invoice_number, invoice.issue_date, invoice.due_date, invoice.payment_term_days,
      invoice.customer_name, invoice.customer_contact_title, invoice.customer_contact_given_name, invoice.customer_contact_family_name,
      invoice.customer_address_street, invoice.customer_address_postal_code,
      invoice.customer_address_city, invoice.customer_address_country, invoice.customer_email,
      invoice.customer_kvk, invoice.customer_tax_id, invoice.memo, invoice.tax_inclusive,
      invoice.discount_type, invoice.discount_pct, invoice.discount_cents,
      invoice.invert_logo,
      invoice.subtotal_cents, invoice.tax_cents, invoice.total_cents,
      invoice.created_by_user_id,
    ],
  )
  return rows[0].id
}

export async function deleteInvoiceRow(executor, tenantId, invoiceId) {
  const { rowCount } = await executor.query(
    'DELETE FROM invoices WHERE id = $1 AND tenant_id = $2',
    [invoiceId, tenantId],
  )
  return rowCount > 0
}

export async function setCustomLogoPath(executor, tenantId, invoiceId, key) {
  await executor.query(
    'UPDATE invoices SET custom_logo_path = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
    [key, invoiceId, tenantId],
  )
}

// Invoice plus the linked gig's date/description (for email subject lines).
export async function fetchInvoiceWithGig(executor, tenantId, invoiceId) {
  const { rows } = await executor.query(
    `SELECT i.*, g.event_date, g.event_description
       FROM invoices i
       LEFT JOIN gigs g ON g.id = i.gig_id AND g.tenant_id = i.tenant_id
      WHERE i.id = $1 AND i.tenant_id = $2`,
    [invoiceId, tenantId],
  )
  return rows[0] || null
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

// Stores a freshly created Mollie payment link with an atomic guard against
// concurrent creation: writes only when no link is set yet. Returns the
// updated row, or null when another request won the race.
export async function setInvoicePaymentLink(executor, tenantId, invoiceId, { linkId, url, expiresAt }) {
  const { rows } = await executor.query(
    `UPDATE invoices
        SET mollie_payment_link_id = $1,
            mollie_payment_link_url = $2,
            mollie_payment_link_created_at = NOW(),
            mollie_payment_link_expires_at = $3,
            mollie_payment_status = 'open',
            updated_at = NOW()
      WHERE id = $4 AND tenant_id = $5
        AND mollie_payment_link_id IS NULL
    RETURNING *`,
    [linkId, url, expiresAt ?? null, invoiceId, tenantId],
  )
  return rows[0] || null
}

export async function clearInvoicePaymentLink(executor, tenantId, invoiceId) {
  await executor.query(
    `UPDATE invoices
        SET mollie_payment_link_id = NULL,
            mollie_payment_link_url = NULL,
            mollie_payment_link_created_at = NULL,
            mollie_payment_link_expires_at = NULL,
            mollie_payment_status = NULL,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [invoiceId, tenantId],
  )
}

// Writes the payment state pulled from Mollie (and the derived invoice status).
// Returns the updated row, or undefined when the (id, tenant_id) pair matched
// nothing — callers (and tests) rely on undefined, not null, for the no-op case.
export async function updateInvoicePaymentState(executor, tenantId, invoiceId, { mollieStatus, paymentId, paidAt, invoiceStatus }) {
  const { rows } = await executor.query(
    `UPDATE invoices
        SET mollie_payment_status = $1,
            mollie_payment_id     = $2,
            mollie_paid_at        = $3,
            status                = $4,
            updated_at            = NOW()
      WHERE id = $5 AND tenant_id = $6
      RETURNING *`,
    [mollieStatus, paymentId, paidAt, invoiceStatus, invoiceId, tenantId],
  )
  return rows[0]
}

// Count + gross total of open invoices per dashboard bucket: overdue (sent,
// past due), unpaid (sent, not yet due or no due date), draft. Paid and void
// invoices fall outside every bucket.
export async function openInvoiceBuckets(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'sent' AND due_date < CURRENT_DATE)::int AS overdue_count,
            COALESCE(SUM(total_cents) FILTER (WHERE status = 'sent' AND due_date < CURRENT_DATE), 0)::int AS overdue_total_cents,
            COUNT(*) FILTER (WHERE status = 'sent' AND (due_date IS NULL OR due_date >= CURRENT_DATE))::int AS unpaid_count,
            COALESCE(SUM(total_cents) FILTER (WHERE status = 'sent' AND (due_date IS NULL OR due_date >= CURRENT_DATE)), 0)::int AS unpaid_total_cents,
            COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_count,
            COALESCE(SUM(total_cents) FILTER (WHERE status = 'draft'), 0)::int AS draft_total_cents
       FROM invoices
      WHERE tenant_id = $1`,
    [tenantId],
  )
  return rows[0]
}

// Drops the secret Mollie API key before a tenant row is returned to a client.
export function stripMollieKey(tenant) {
  if (!tenant) return tenant
  const safe = { ...tenant }
  delete safe.mollie_api_key
  return safe
}
