// Data-access helpers for subscriptions. Subscriptions are user-owned
// (platform-level), not tenant-scoped; tenant access derives from
// tenants.owner_user_id via the entitlement resolver.

// The one live (non-canceled) subscription for a user, with its plan's slug
// and entitlements joined in. The partial unique index guarantees at most one.
export async function fetchLiveSubscriptionForUser(executor, userId) {
  const { rows } = await executor.query(
    `SELECT s.*, p.slug AS plan_slug, p.entitlements AS plan_entitlements
     FROM subscriptions s
     JOIN subscription_plans p ON p.id = s.plan_id
     WHERE s.user_id = $1 AND s.status <> 'canceled'`,
    [userId],
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
