// Data-access helpers for entitlement resolution.

// Returns the tenant's owner user id, or null when the tenant has no owner
// (legacy tenant — enforcement is skipped) or doesn't exist.
export async function fetchTenantOwner(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT owner_user_id FROM tenants WHERE id = $1',
    [tenantId],
  )
  return rows[0]?.owner_user_id ?? null
}

// Whether the tenant has any finance data (invoices, purchases, or posted
// ledger transactions). Drives financeReadOnly: losing the finance feature
// blocks writes while reads/exports stay available — a downgrade must never
// silently destroy or trap the band's own records. (The app is a GDPR data
// processor: fiscal retention is the band's duty, and data is deleted with
// the tenant/account, not archived indefinitely.)
export async function tenantHasFinanceData(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT EXISTS (SELECT 1 FROM invoices WHERE tenant_id = $1)
         OR EXISTS (SELECT 1 FROM purchases WHERE tenant_id = $1)
         OR EXISTS (SELECT 1 FROM ledger_transactions WHERE tenant_id = $1)
       AS has_finance_data`,
    [tenantId],
  )
  return rows[0].has_finance_data === true
}
