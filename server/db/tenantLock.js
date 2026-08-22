// THE per-tenant advisory lock. One key space, one owner — every caller passes
// the bare tenant id to `pg_advisory_xact_lock`, so they all serialize against
// each other. That mutual exclusion is the point, and it spans three slices:
//
//   - storage quota (statisticsService): reserve / release / recompute usage
//   - gated writes (featureGuards): entitlement recheck around a feature write
//   - capacity prechecks (moduleCapacityService): a downgrade measuring usage
//     against the target plan's limits
//
// A downgrade that commits a lower limits snapshot must not be outrun by an
// upload that resolved the OLD limit, and vice versa; that only holds while all
// three take the SAME lock. Adding a namespace argument here, or reintroducing
// a local copy of this query with a different key, silently breaks it — the
// paths stop colliding and nothing fails loudly.
//
// Transaction-scoped: released on COMMIT/ROLLBACK, so callers must be inside a
// transaction and never unlock by hand. Distinct from the two-argument
// (namespace, id) session locks used by finance and the reconciliation jobs.
export async function lockTenantUsage(executor, tenantId) {
  await executor.query('SELECT pg_advisory_xact_lock($1)', [tenantId])
}
