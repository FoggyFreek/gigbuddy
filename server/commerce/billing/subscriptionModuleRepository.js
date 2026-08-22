// Data access for subscription modules — the band and artist products a single
// subscription is composed of. A module belongs to a subscription, which
// belongs to a user; tenant access derives from tenants.owner_user_id through
// the entitlement resolver.
//
// Absence of a module for an audience is meaningful: it resolves to that
// ladder's free fallback plan. A `pending` module (bought, charge not yet
// settled) grants nothing yet but already binds its target capacity.

import { BOUNDARY_KINDS } from './pendingChangeKinds.js'

// Plan pricing columns come along so the pricing engine can quote a module set
// from one read — every quote needs both the current plan and the plan a
// scheduled change lands on.
const MODULE_SELECT = `
  m.*,
  p.slug AS plan_slug, p.entitlements AS plan_entitlements,
  p.monthly_price_cents, p.yearly_price_cents,
  pp.slug AS pending_plan_slug, pp.entitlements AS pending_plan_entitlements,
  pp.monthly_price_cents AS pending_monthly_price_cents,
  pp.yearly_price_cents AS pending_yearly_price_cents`

const MODULE_FROM = `
  FROM subscription_modules m
  JOIN subscription_plans p ON p.id = m.plan_id
  LEFT JOIN subscription_plans pp ON pp.id = m.pending_plan_id`

export async function listModules(executor, subscriptionId) {
  const { rows } = await executor.query(
    `SELECT ${MODULE_SELECT} ${MODULE_FROM}
      WHERE m.subscription_id = $1 ORDER BY m.audience ASC`,
    [subscriptionId],
  )
  return rows
}

// Locked alongside the subscription row every pricing decision takes, so a
// concurrent add/upgrade cannot change the module set under a quote.
export async function listModulesForUpdate(executor, subscriptionId) {
  const { rows } = await executor.query(
    `SELECT ${MODULE_SELECT} ${MODULE_FROM}
      WHERE m.subscription_id = $1 ORDER BY m.audience ASC FOR UPDATE OF m`,
    [subscriptionId],
  )
  return rows
}

export async function fetchModule(executor, subscriptionId, audience) {
  const { rows } = await executor.query(
    `SELECT ${MODULE_SELECT} ${MODULE_FROM}
      WHERE m.subscription_id = $1 AND m.audience = $2`,
    [subscriptionId, audience],
  )
  return rows[0] ?? null
}

export async function fetchModuleById(executor, id) {
  const { rows } = await executor.query(
    `SELECT ${MODULE_SELECT} ${MODULE_FROM} WHERE m.id = $1`,
    [id],
  )
  return rows[0] ?? null
}

const INSERTABLE = [
  'subscription_id', 'plan_id', 'status', 'price_cents', 'is_starter',
  'entitlement_overrides',
]

// `audience` is deliberately not insertable — the DB trigger derives it from
// the plan and discards anything a caller supplies.
export async function insertModule(executor, fields) {
  const cols = INSERTABLE.filter((c) => fields[c] !== undefined)
  const values = cols.map((c) => fields[c])
  const { rows } = await executor.query(
    `INSERT INTO subscription_modules (${cols.join(', ')})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING *`,
    values,
  )
  return rows[0]
}

// Re-prices a module against a new billing interval. The plan does not change,
// so this never touches the audience triggers.
export async function setModulePrice(executor, id, priceCents) {
  await executor.query(
    'UPDATE subscription_modules SET price_cents = $2, updated_at = NOW() WHERE id = $1',
    [id, priceCents],
  )
}

// Immediate plan switch — the free trial case, where there is nothing to
// charge and no period to prorate against.
export async function switchModulePlan(executor, id, { planId, priceCents }) {
  const { rows } = await executor.query(
    `UPDATE subscription_modules
        SET plan_id = $2, price_cents = $3, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, planId, priceCents],
  )
  return rows[0] ?? null
}

// A scheduled change that carries no capacity binding of its own — an upgrade,
// or a re-price of an existing trial selection. `kind = 'remove'` goes through
// setModuleRemoval instead, which also moves the status.
//
// Deliberately leaves pending_limits_snapshot alone: it is the only writer that
// runs over a row whose snapshot was frozen elsewhere (the interval switch at
// checkout re-prices a trial selection without changing its target plan).
export async function setModulePendingChange(executor, id, { planId, kind, priceCents }) {
  const { rows } = await executor.query(
    `UPDATE subscription_modules
        SET pending_plan_id = $2, pending_change_kind = $3, pending_price_cents = $4,
            updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, planId, kind, priceCents],
  )
  return rows[0] ?? null
}

// A trial's selected paid plan, with the target limits frozen at selection.
// Like a downgrade it binds capacity immediately (PENDING_CHANGE_KINDS
// declares `bindsCapacity`), but it carries no purge manifest and no
// downgrade_confirmed_at: the trial tier keeps granting its features until the
// first charge lands this plan, so nothing is lost and nothing is consented to.
//
// The snapshot is always written, never merged — re-selecting a different plan
// must replace the previous target's binding, not keep the tighter one.
export async function setModuleTrialSelection(executor, id, { planId, priceCents, snapshot }) {
  const { rows } = await executor.query(
    `UPDATE subscription_modules
        SET pending_plan_id = $2, pending_change_kind = 'trial_selection',
            pending_price_cents = $3, pending_limits_snapshot = $4,
            updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, planId, priceCents, snapshot],
  )
  return rows[0] ?? null
}

// Downgrade confirmation: the scheduled target plus the manifest and limits
// snapshot frozen at that moment. The snapshot binds capacity growth through
// the resolver immediately; the manifest executes only once the target plan is
// actually real.
export async function setModuleDowngrade(executor, id, { planId, priceCents, manifest, snapshot }) {
  const { rows } = await executor.query(
    `UPDATE subscription_modules
        SET pending_plan_id = $2, pending_change_kind = 'downgrade', pending_price_cents = $3,
            pending_purge_manifest = $4, pending_limits_snapshot = $5,
            downgrade_confirmed_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, planId, priceCents, manifest, snapshot],
  )
  return rows[0] ?? null
}

// Removal confirmation. The module keeps granting its entitlements until the
// period boundary — the customer paid for this period.
export async function setModuleRemoval(executor, id, { manifest, snapshot }) {
  const { rows } = await executor.query(
    `UPDATE subscription_modules
        SET status = 'pending_removal', pending_change_kind = 'remove',
            pending_plan_id = NULL, pending_price_cents = NULL,
            pending_purge_manifest = $2, pending_limits_snapshot = $3,
            downgrade_confirmed_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, manifest, snapshot],
  )
  return rows[0] ?? null
}

// Freezes a purge manifest WITHOUT scheduling a change — the trial case, where
// the target plan is already real and the purge runs right after the commit.
// Persisting it first is what lets the scheduler's safety net finish the purge
// if the process dies in between.
export async function setModulePurgeManifest(executor, id, { manifest, snapshot }) {
  const { rows } = await executor.query(
    `UPDATE subscription_modules
        SET pending_purge_manifest = $2, pending_limits_snapshot = $3,
            downgrade_confirmed_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, manifest, snapshot],
  )
  return rows[0] ?? null
}

// Drops a scheduled change and returns the module to plain `active`. Used when
// a charge fails terminally, and when the user cancels a pending downgrade —
// in both cases NOTHING is purged, because the target plan never became real.
export async function clearModulePendingChange(executor, id) {
  const { rows } = await executor.query(
    `UPDATE subscription_modules
        SET pending_plan_id = NULL, pending_change_kind = NULL, pending_price_cents = NULL,
            pending_purge_manifest = NULL, pending_limits_snapshot = NULL,
            downgrade_confirmed_at = NULL,
            status = CASE WHEN status = 'pending_removal' THEN 'active' ELSE status END,
            updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id],
  )
  return rows[0] ?? null
}

// Activation of a paid module change: a pending add becomes active, a
// scheduled plan change lands. The purge manifest is deliberately KEPT — the
// post-commit purge consumes it once the target plan is real.
//
// The limits snapshot goes, because the plan now carries the target limits
// itself. Leaving it would outlive the change that froze it: a landed
// trial_selection has no manifest, so no later clearModulePurgeManifest would
// ever remove it, and a subsequent upgrade would stay capped at the old target.
export async function applyModuleChange(executor, id) {
  const { rows } = await executor.query(
    `UPDATE subscription_modules
        SET plan_id = COALESCE(pending_plan_id, plan_id),
            price_cents = COALESCE(pending_price_cents, price_cents),
            status = 'active',
            pending_plan_id = NULL, pending_change_kind = NULL, pending_price_cents = NULL,
            pending_limits_snapshot = NULL,
            updated_at = NOW()
      WHERE id = $1 AND status <> 'pending_removal' RETURNING *`,
    [id],
  )
  return rows[0] ?? null
}

// Removal at the period boundary. The row goes; its purge manifest was copied
// out by the caller first, because the purge runs after the commit.
export async function deleteModule(executor, id) {
  const { rowCount } = await executor.query(
    'DELETE FROM subscription_modules WHERE id = $1',
    [id],
  )
  return rowCount > 0
}

// Consumes an executed purge manifest. Guarded on presence so a replayed call
// is inert; the limits snapshot goes with it, since the plan itself now carries
// the target limits.
export async function clearModulePurgeManifest(executor, id) {
  await executor.query(
    `UPDATE subscription_modules
        SET pending_purge_manifest = NULL, pending_limits_snapshot = NULL,
            downgrade_confirmed_at = NULL, updated_at = NOW()
      WHERE id = $1 AND pending_purge_manifest IS NOT NULL`,
    [id],
  )
}

// Safety net for the purge: manifests whose change already took effect (no
// scheduled change left) but whose inline purge never ran.
export async function listModulesWithPendingPurge(executor) {
  const { rows } = await executor.query(
    `SELECT m.*, s.user_id
       FROM subscription_modules m
       JOIN subscriptions s ON s.id = m.subscription_id
      WHERE m.pending_purge_manifest IS NOT NULL
        AND m.pending_change_kind IS NULL`,
  )
  return rows
}

// The module awaiting a prorated charge: a pending add, or a scheduled upgrade.
// The service allows only one such change in flight per subscription, so the
// paid charge is unambiguously attributable to it.
export async function fetchInFlightModuleChange(executor, subscriptionId) {
  const { rows } = await executor.query(
    `SELECT ${MODULE_SELECT} ${MODULE_FROM}
      WHERE m.subscription_id = $1
        AND (m.status = 'pending' OR m.pending_change_kind = 'upgrade')
      LIMIT 1`,
    [subscriptionId],
  )
  return rows[0] ?? null
}

// Modules whose scheduled change is due at the period boundary. Which kinds
// those are is derived from PENDING_CHANGE_KINDS rather than restated here.
export async function listModuleChangesDueAtPeriodEnd(executor, subscriptionId) {
  const { rows } = await executor.query(
    `SELECT ${MODULE_SELECT} ${MODULE_FROM}
      WHERE m.subscription_id = $1
        AND m.pending_change_kind = ANY($2)`,
    [subscriptionId, BOUNDARY_KINDS],
  )
  return rows
}
