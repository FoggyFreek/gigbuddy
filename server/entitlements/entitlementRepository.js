// Data-access helpers for entitlement resolution. These read whatever table
// answers the resolution question — tenants, finance data, and the billing
// tables that are the source of truth for what a user has bought. The resolver
// enforces every time bound on READ, so none of this may become a cached
// projection.

// The tenant's owner and kind, or null when the tenant doesn't exist. Kind
// selects which of the owner's two subscriptions governs this tenant, so it
// travels with the owner rather than being looked up separately.
// `owner_user_id` null = legacy ownerless tenant, enforcement skipped.
export async function fetchTenantOwnership(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT owner_user_id, kind FROM tenants WHERE id = $1',
    [tenantId],
  )
  return rows[0] ?? null
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

// The entitlement resolver's hot path: one round trip from a user and an
// audience to the subscription row plus that ladder's module. Returns null when
// the user has no live subscription at all; a live subscription WITHOUT a module
// for this audience returns the subscription with null module columns, which the
// resolver reads as "free fallback on this ladder".
export async function fetchLiveModuleForUser(executor, userId, audience) {
  const { rows } = await executor.query(
    `SELECT s.*,
            m.id AS module_id, m.status AS module_status,
            m.entitlement_overrides, m.pending_limits_snapshot,
            m.pending_change_kind, m.pending_plan_id,
            p.slug AS plan_slug, p.entitlements AS plan_entitlements
       FROM subscriptions s
       LEFT JOIN subscription_modules m
         ON m.subscription_id = s.id AND m.audience = $2
       LEFT JOIN subscription_plans p ON p.id = m.plan_id
      WHERE s.user_id = $1 AND s.status <> 'canceled'`,
    [userId, audience],
  )
  return rows[0] ?? null
}

// True when a recurring charge created after the current period started is
// still nonterminal at Mollie (open/pending) — the SEPA-in-flight case that
// extends the resolver's grace window.
export async function hasNonterminalRecurringPayment(executor, subscriptionId, periodStart) {
  const { rowCount } = await executor.query(
    `SELECT 1 FROM subscription_payments
     WHERE subscription_id = $1
       AND kind = 'recurring'
       AND status IN ('open', 'pending')
       AND mollie_created_at > $2
     LIMIT 1`,
    [subscriptionId, periodStart],
  )
  return rowCount > 0
}
