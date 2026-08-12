// Data-access helpers for invoices. Each takes an `executor` (a pool or a
// transaction client) so callers control transaction boundaries.
import { formatInvoiceNumber } from '../../domain/invoice.js'
import { invoiceProjection } from './invoiceProjection.js'

export async function acquireSessionLock(executor, namespace, resourceId) {
  await executor.query('SELECT pg_advisory_lock($1, $2)', [namespace, resourceId])
}

export async function releaseSessionLock(executor, namespace, resourceId) {
  await executor.query('SELECT pg_advisory_unlock($1, $2)', [namespace, resourceId])
}

// `period` is the { sql, values } pair from buildPeriodWhere(query, 'issue_date').
export async function listInvoices(executor, tenantId, period) {
  const { rows } = await executor.query(
    `SELECT id, invoice_number, gig_id, issue_date, due_date, currency,
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

// Invoices that still carry a Mollie payment link — the integrations purge
// enumerates these to remove unpaid links and decide key retention.
export async function listInvoicesWithPaymentLink(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT * FROM invoices
      WHERE tenant_id = $1 AND mollie_payment_link_id IS NOT NULL
      ORDER BY id ASC`,
    [tenantId],
  )
  return rows
}

export async function countInvoicesWithPaymentLink(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT COUNT(*)::int AS count FROM invoices
      WHERE tenant_id = $1 AND mollie_payment_link_id IS NOT NULL`,
    [tenantId],
  )
  return rows[0].count
}

// Global-search read: matches invoices on invoice number, customer name, or the
// linked gig's event name (invoices.gig_id → gigs(id, tenant_id), nullable).
// Exact invoice-number matches sort first, then most recent. Tenant-scoped.
export async function searchInvoices(executor, tenantId, like, limit) {
  const { rows } = await executor.query(
    `SELECT i.id, i.invoice_number, i.customer_name, i.total_cents, i.currency, i.status,
            i.issue_date, g.event_description AS gig_event_description
       FROM invoices i
       LEFT JOIN gigs g ON g.id = i.gig_id AND g.tenant_id = i.tenant_id
      WHERE i.tenant_id = $1
        AND (i.invoice_number ILIKE $2 OR i.customer_name ILIKE $2
             OR g.event_description ILIKE $2)
      ORDER BY
        CASE WHEN i.invoice_number ILIKE $2 THEN 0 ELSE 1 END,
        i.issue_date DESC, i.id DESC
      LIMIT $3`,
    [tenantId, like, limit],
  )
  return rows
}

// Gig ids with any linked invoice. The caller supplies an already tenant-scoped
// gig result set; both sides are scoped again here so invoice state can never
// leak across tenants.
export async function listGigIdsWithInvoices(executor, tenantId, gigIds) {
  if (gigIds.length === 0) return []
  const { rows } = await executor.query(
    `SELECT DISTINCT gig_id
       FROM invoices
      WHERE tenant_id = $1
        AND gig_id = ANY($2::int[])`,
    [tenantId, gigIds],
  )
  return rows.map((row) => row.gig_id)
}

// Active invoices linked to a single gig (invoices.gig_id → gigs), tenant-scoped.
// Excludes voided invoices so only live states (draft/sent/paid) surface on the
// gig's Terms tab. Ordered newest issue date first.
export async function listInvoicesByGig(executor, tenantId, gigId) {
  const { rows } = await executor.query(
    `SELECT id, invoice_number, status, issue_date, due_date,
            payment_term_days, customer_name, total_cents
       FROM invoices
      WHERE tenant_id = $1
        AND gig_id = $2
        AND status <> 'void'
      ORDER BY issue_date DESC, id DESC`,
    [tenantId, gigId],
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
    `SELECT ${invoiceProjection()} FROM invoices WHERE id = $1 AND tenant_id = $2`,
    [invoiceId, tenantId],
  )
  return rows[0] || null
}

export async function lockInvoice(executor, tenantId, invoiceId) {
  const { rows } = await executor.query(
    `SELECT ${invoiceProjection()} FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [invoiceId, tenantId],
  )
  return rows[0] || null
}

export async function lockInvoiceTotalsState(executor, tenantId, invoiceId) {
  const { rows } = await executor.query(
    `SELECT tax_inclusive, reverse_charge, customer_tax_id, customer_address_country,
            discount_type, discount_pct, discount_cents, finalized_at
       FROM invoices WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
    [invoiceId, tenantId],
  )
  return rows[0] || null
}

// `snapshot` is the VAT treatment to freeze onto the row when this update is the
// one that ISSUES the invoice. Every column is written as COALESCE(col, $n):
// first writer wins, in SQL. An already-snapshotted invoice can therefore never
// have its treatment rewritten by any path that re-enters — a read-then-check
// guard could be raced through, this cannot.
export async function updateInvoiceFields(executor, tenantId, invoiceId, { columns, finalize, snapshot = null }) {
  const assignments = []
  const values = []
  let index = 1
  for (const { column, value } of columns) {
    assignments.push(`${column} = $${index++}`)
    values.push(value)
  }
  if (snapshot) {
    for (const [column, value] of Object.entries(snapshot)) {
      assignments.push(`${column} = COALESCE(${column}, $${index++})`)
      values.push(value)
    }
  }
  if (finalize) assignments.push('finalized_at = NOW()')
  assignments.push('updated_at = NOW()')
  values.push(invoiceId, tenantId)
  await executor.query(
    `UPDATE invoices SET ${assignments.join(', ')} WHERE id = $${index} AND tenant_id = $${index + 1}`,
    values,
  )
}

// ---------- VAT snapshot audit ----------
//
// ISSUED, not merely finalized: applyStatusFields stamps finalized_at on
// draft -> void too, and an abandoned draft was never issued. The EXISTS clause
// catches an invoice that was issued and later voided.
const ISSUED_INVOICE = `(
  i.status IN ('sent', 'paid')
  OR EXISTS (SELECT 1 FROM ledger_transactions lt
              WHERE lt.tenant_id = i.tenant_id AND lt.source_type = 'invoice'
                AND lt.source_id = i.id AND lt.source_event = 'sent')
)`

// Issued invoices carrying no VAT snapshot — rows the previous app container
// issued during a deployment, before the new code took over. Repairable.
export async function listIssuedInvoicesMissingSnapshot(executor) {
  const { rows } = await executor.query(
    `SELECT i.id, i.tenant_id, i.invoice_number, i.status, i.tax_cents,
            i.reverse_charge, i.supply_date, i.issue_date
       FROM invoices i
      WHERE i.accounting_country_snapshot IS NULL
        AND ${ISSUED_INVOICE}
      ORDER BY i.tenant_id, i.id`,
  )
  return rows
}

// Invoices whose stored VAT contradicts their snapshotted treatment. NEVER
// auto-repaired: the ledger already posted whatever tax_cents says, so which of
// the two is wrong is a human judgement and the fix is a correction document,
// not an UPDATE.
export async function listInvoiceSnapshotConflicts(executor) {
  const { rows } = await executor.query(
    `SELECT i.id, i.tenant_id, i.invoice_number, i.tax_cents,
            i.vat_treatment_snapshot, i.charges_output_vat_snapshot, i.vat_snapshot_source
       FROM invoices i
      WHERE i.vat_treatment_snapshot IS NOT NULL
        AND ((i.tax_cents > 0) <> COALESCE(i.charges_output_vat_snapshot, FALSE))
      ORDER BY i.tenant_id, i.id`,
  )
  return rows
}

// Snapshots this migration INFERRED and no human has confirmed. Not a fault —
// a finding, and the population a bulk confirmation would clear.
export async function countInferredInvoiceSnapshots(executor) {
  const { rows } = await executor.query(
    `SELECT COUNT(*)::int AS count FROM invoices
      WHERE vat_snapshot_source = 'legacy_inferred'`,
  )
  return rows[0].count
}

// Documents whose recorded scheme did not actually produce its treatment — a
// scheme that is recorded but not implemented. Expected, and worth surfacing so
// the size of the "recorded but inert" population is visible.
export async function countUnimplementedSchemeInvoices(executor, implementedCodes) {
  const { rows } = await executor.query(
    `SELECT COUNT(*)::int AS count FROM invoices
      WHERE vat_scheme_code_snapshot IS NOT NULL
        AND NOT (vat_scheme_code_snapshot = ANY($1::text[]))
        AND vat_treatment_snapshot = 'standard'`,
    [implementedCodes],
  )
  return rows[0].count
}

// Corrects a snapshot the MIGRATION inferred. Scoped to 'legacy_inferred' in the
// WHERE clause, so an 'issued' or already-'confirmed' row is untouchable however
// the caller is written — the same first-writer-wins discipline the capture path
// uses, expressed as a guard the database enforces.
export async function confirmInvoiceVatSnapshot(executor, tenantId, invoiceId, snapshot) {
  const { rows } = await executor.query(
    `UPDATE invoices
        SET vat_treatment_snapshot = $3,
            charges_output_vat_snapshot = $4,
            vat_scheme_code_snapshot = $5,
            vat_snapshot_source = 'confirmed',
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND vat_snapshot_source = 'legacy_inferred'
    RETURNING ${invoiceProjection()}`,
    [
      invoiceId, tenantId,
      snapshot.vat_treatment_snapshot,
      snapshot.charges_output_vat_snapshot,
      snapshot.vat_scheme_code_snapshot ?? null,
    ],
  )
  return rows[0] || null
}

export async function setInvoiceVatSnapshot(executor, invoiceId, snapshot) {
  await executor.query(
    `UPDATE invoices
        SET accounting_country_snapshot = COALESCE(accounting_country_snapshot, $2),
            vat_scheme_code_snapshot = COALESCE(vat_scheme_code_snapshot, $3),
            vat_treatment_snapshot = COALESCE(vat_treatment_snapshot, $4),
            charges_output_vat_snapshot = COALESCE(charges_output_vat_snapshot, $5),
            vat_treatment_version = COALESCE(vat_treatment_version, $6),
            vat_snapshot_source = COALESCE(vat_snapshot_source, $7),
            updated_at = NOW()
      WHERE id = $1`,
    [
      invoiceId,
      snapshot.accounting_country_snapshot,
      snapshot.vat_scheme_code_snapshot,
      snapshot.vat_treatment_snapshot,
      snapshot.charges_output_vat_snapshot,
      snapshot.vat_treatment_version,
      snapshot.vat_snapshot_source,
    ],
  )
}

export async function setInvoicePdfPath(executor, tenantId, invoiceId, pdfPath) {
  await executor.query(
    'UPDATE invoices SET pdf_path = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
    [pdfPath, invoiceId, tenantId],
  )
}

// The second issuing path (draft -> sent for a payment link). Freezes the VAT
// treatment in the same statement as finalized_at, and with the same
// first-writer-wins COALESCE the PATCH path uses.
export async function finalizeInvoiceForPaymentLink(executor, tenantId, invoiceId, snapshot) {
  const { rows } = await executor.query(
    `UPDATE invoices
        SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
            finalized_at = COALESCE(finalized_at, NOW()),
            accounting_country_snapshot = COALESCE(accounting_country_snapshot, $3),
            vat_scheme_code_snapshot = COALESCE(vat_scheme_code_snapshot, $4),
            vat_treatment_snapshot = COALESCE(vat_treatment_snapshot, $5),
            charges_output_vat_snapshot = COALESCE(charges_output_vat_snapshot, $6),
            vat_treatment_version = COALESCE(vat_treatment_version, $7),
            vat_snapshot_source = COALESCE(vat_snapshot_source, $8),
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
    RETURNING ${invoiceProjection()}`,
    [
      invoiceId, tenantId,
      snapshot.accounting_country_snapshot,
      snapshot.vat_scheme_code_snapshot,
      snapshot.vat_treatment_snapshot,
      snapshot.charges_output_vat_snapshot,
      snapshot.vat_treatment_version,
      snapshot.vat_snapshot_source,
    ],
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

export async function fetchPublicMollieInvoice(executor, invoiceId) {
  const { rows } = await executor.query(
    `SELECT ${invoiceProjection('i')}
       FROM invoices i
      WHERE i.id = $1 AND i.mollie_payment_link_id IS NOT NULL`,
    [invoiceId],
  )
  return rows[0] || null
}

export async function fetchLines(executor, invoiceId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, description, quantity, unit_price_cents, tax_percentage,
            tax_category_code, tax_jurisdiction_code, position
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
       reverse_charge, supply_date,
       discount_type, discount_pct, discount_cents,
       invert_logo,
       subtotal_cents, tax_cents, total_cents,
       currency, created_by_user_id,
       vies_checked_at, vies_checked_vat_number, vies_consultation_number
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10,
       $11, $12,
       $13, $14, $15,
       $16, $17, $18, $19,
       $20, $21,
       $22, $23, $24,
       $25,
       $26, $27, $28,
       $29, $30,
       $31, $32, $33
     ) RETURNING id`,
    [
      invoice.tenant_id, invoice.gig_id, invoice.invoice_number, invoice.issue_date, invoice.due_date, invoice.payment_term_days,
      invoice.customer_name, invoice.customer_contact_title, invoice.customer_contact_given_name, invoice.customer_contact_family_name,
      invoice.customer_address_street, invoice.customer_address_postal_code,
      invoice.customer_address_city, invoice.customer_address_country, invoice.customer_email,
      invoice.customer_kvk, invoice.customer_tax_id, invoice.memo, invoice.tax_inclusive,
      invoice.reverse_charge, invoice.supply_date,
      invoice.discount_type, invoice.discount_pct, invoice.discount_cents,
      invoice.invert_logo,
      invoice.subtotal_cents, invoice.tax_cents, invoice.total_cents,
      invoice.currency, invoice.created_by_user_id,
      invoice.vies_checked_at ?? null, invoice.vies_checked_vat_number ?? null, invoice.vies_consultation_number ?? null,
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
    `SELECT ${invoiceProjection('i')}, g.event_date, g.event_description
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
      `INSERT INTO invoice_lines (
         invoice_id, tenant_id, position, description, quantity, unit_price_cents,
         tax_percentage, tax_category_code, tax_jurisdiction_code
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        invoiceId, tenantId, line.position, line.description, line.quantity,
        line.unit_price_cents, line.tax_percentage, line.tax_category_code ?? null,
        line.tax_jurisdiction_code ?? null,
      ],
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
    RETURNING ${invoiceProjection()}`,
    [linkId, url, expiresAt ?? null, invoiceId, tenantId],
  )
  return rows[0] || null
}

export async function clearInvoicePaymentLink(executor, tenantId, invoiceId, expectedLinkId = null) {
  const { rows } = await executor.query(
    `UPDATE invoices
        SET mollie_payment_link_id = NULL,
            mollie_payment_link_url = NULL,
            mollie_payment_link_created_at = NULL,
            mollie_payment_link_expires_at = NULL,
            mollie_payment_status = NULL,
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
        AND ($3::text IS NULL OR mollie_payment_link_id = $3)
      RETURNING ${invoiceProjection()}`,
    [invoiceId, tenantId, expectedLinkId],
  )
  return rows[0] || null
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
      RETURNING ${invoiceProjection()}`,
    [mollieStatus, paymentId, paidAt, invoiceStatus, invoiceId, tenantId],
  )
  return rows[0]
}

// Flips an invoice to paid (status only), tenant-scoped. Returns the updated row
// (or null when no row matched) so a caller can confirm exactly one row changed
// before posting the ledger journal — used by the bank-statement importer.
export async function markInvoicePaid(executor, tenantId, invoiceId) {
  const { rows } = await executor.query(
    `UPDATE invoices SET status = 'paid', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING ${invoiceProjection()}`,
    [invoiceId, tenantId],
  )
  return rows[0] || null
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
