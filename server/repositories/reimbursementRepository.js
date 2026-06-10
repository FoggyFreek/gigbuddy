// Data-access helpers for reimbursements. Each takes an `executor` (a pool or a
// transaction client) so callers control transaction boundaries.
//
// Outstanding member debt is derived from purchases + reimbursements (ledger
// entries carry no band_member_id): a purchase is outstanding while it is
// member-paid, paid, and not yet claimed by a reimbursement.

// Outstanding total per band member: unsettled member-paid purchases, grouped.
// Only members who are actually owed something appear. SUM/COUNT come back as
// int8, so cast to int for clean JSON numbers.
export async function fetchOutstandingByMember(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT bm.id AS band_member_id, bm.name AS band_member_name, bm.user_id,
            COALESCE(SUM(p.total_cents), 0)::int AS outstanding_cents,
            COUNT(p.id)::int                     AS outstanding_count
       FROM band_members bm
       LEFT JOIN purchases p
         ON p.paid_by_band_member_id = bm.id AND p.tenant_id = bm.tenant_id
        AND p.payment_method = 'member' AND p.status = 'paid'
        AND p.reimbursement_id IS NULL
      WHERE bm.tenant_id = $1
      GROUP BY bm.id, bm.name, bm.user_id
     HAVING COALESCE(SUM(p.total_cents), 0) > 0
      ORDER BY outstanding_cents DESC, bm.sort_order ASC, bm.name ASC`,
    [tenantId],
  )
  return rows
}

// The unsettled member-paid purchases a given member fronted (the expand panel
// and the validation source for a reimbursement selection). Includes the first
// line's description for display, like the purchases list.
export async function fetchOutstandingPurchases(executor, tenantId, bandMemberId) {
  const { rows } = await executor.query(
    `SELECT p.id, p.receipt_number, p.supplier_name, p.receipt_date,
            p.total_cents, fl.description
       FROM purchases p
       LEFT JOIN LATERAL (
         SELECT description FROM purchase_lines pl
          WHERE pl.purchase_id = p.id AND pl.tenant_id = p.tenant_id
          ORDER BY position ASC, id ASC
          LIMIT 1
       ) fl ON TRUE
      WHERE p.tenant_id = $1
        AND p.paid_by_band_member_id = $2
        AND p.payment_method = 'member' AND p.status = 'paid'
        AND p.reimbursement_id IS NULL
      ORDER BY p.receipt_date ASC, p.id ASC`,
    [tenantId, bandMemberId],
  )
  return rows
}

export async function insertReimbursement(client, tenantId, { band_member_id, amount_cents, paid_on, memo }) {
  const { rows } = await client.query(
    `INSERT INTO reimbursements (tenant_id, band_member_id, amount_cents, paid_on, memo)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [tenantId, band_member_id, amount_cents, paid_on, memo ?? null],
  )
  return rows[0]
}

// Claims the selected purchases for a reimbursement. Re-checks the outstanding
// predicate so a concurrent settlement can't double-claim a row; returns the
// number of rows actually claimed (the caller asserts it equals the selection).
export async function settlePurchases(client, tenantId, reimbursementId, purchaseIds) {
  const { rowCount } = await client.query(
    `UPDATE purchases SET reimbursement_id = $2, updated_at = NOW()
      WHERE tenant_id = $1 AND id = ANY($3::int[])
        AND payment_method = 'member' AND status = 'paid'
        AND reimbursement_id IS NULL`,
    [tenantId, reimbursementId, purchaseIds],
  )
  return rowCount
}

// History: past reimbursements with the member name and the purchases each one
// settled. `period` is a { sql, values } fragment from buildPeriodWhere on
// r.paid_on (values follow tenantId as $2, $3...).
export async function listReimbursements(executor, tenantId, period = { sql: '', values: [] }) {
  const { rows } = await executor.query(
    `SELECT r.id, r.band_member_id, bm.name AS band_member_name,
            r.amount_cents, to_char(r.paid_on, 'YYYY-MM-DD') AS paid_on,
            r.memo, r.created_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', p.id, 'receipt_number', p.receipt_number,
                  'supplier_name', p.supplier_name, 'total_cents', p.total_cents
                ) ORDER BY p.receipt_number
              ) FILTER (WHERE p.id IS NOT NULL),
              '[]'
            ) AS purchases
       FROM reimbursements r
       JOIN band_members bm ON bm.id = r.band_member_id AND bm.tenant_id = r.tenant_id
       LEFT JOIN purchases p ON p.reimbursement_id = r.id AND p.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1
        ${period.sql}
      GROUP BY r.id, bm.name
      ORDER BY r.paid_on DESC, r.id DESC`,
    [tenantId, ...period.values],
  )
  return rows
}

export async function fetchReimbursementPeriods(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT DISTINCT to_char(paid_on, 'YYYY-MM-DD') AS date
       FROM reimbursements
      WHERE tenant_id = $1
      ORDER BY date DESC`,
    [tenantId],
  )
  return rows.map((row) => row.date)
}
