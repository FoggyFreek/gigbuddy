// Pricing rule catalog domain logic. Rules are platform-level (no tenant
// scope); routes gate access to super admins. Expected failures return
// { error: { status, body } }; success returns a domain payload.
//
// The invariant this service exists to protect: **pricing semantics are never
// edited in place.** A stored price snapshot records { code, version } for
// every discount it was priced with, so the row that priced an existing
// agreement must stay on disk exactly as it was. Changing what a rule charges
// therefore deactivates the live version and inserts the next one; only the
// cosmetic name and the active flag are editable directly.
import { withTransaction, abortTransaction } from '../../db/withTransaction.js'
import {
  listPricingRules as listRuleRows,
  listActivePricingRules,
  fetchPricingRule,
  lockCodeGroup,
  insertPricingRule,
  updatePricingRuleCosmetics,
  deactivatePricingRule,
} from './pricingRuleRepository.js'
import {
  validatePricingRule,
  buildPricingRuleCandidate,
  SEMANTIC_FIELDS,
} from './pricingRuleValidators.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'

const NOT_FOUND = notFound('Pricing rule not found')
const CODE_ALREADY_LIVE = conflict(
  'A live pricing rule already exists for this code — supersede it with a new version instead',
  { code: 'code_already_live' },
)

export { listActivePricingRules }

export async function listPricingRules(db) {
  return listRuleRows(db)
}

// Inserts `rule` as the next version of its code, under a lock on the code
// group. Versions count up from the highest EVER used, never from the live one:
// reusing a retired number would make a snapshot's { code, version } ambiguous.
async function insertNextVersion(client, rule) {
  const existing = await lockCodeGroup(client, rule.code)
  if (existing.some((row) => row.is_active)) abortTransaction(CODE_ALREADY_LIVE)
  const version = existing.reduce((max, row) => Math.max(max, row.version), 0) + 1
  return insertPricingRule(client, { ...rule, version })
}

export async function createPricingRule(db, body) {
  const candidate = buildPricingRuleCandidate(body)
  const error = validatePricingRule(candidate)
  if (error) return badRequest(error)

  return withTransaction(async (client) => ({ rule: await insertNextVersion(client, candidate) }), {
    db,
    // The partial unique index on (code) WHERE is_active is the backstop for a
    // race the lock above cannot cover: the first-ever row of a code.
    mapError: (err) => (err.code === '23505' ? CODE_ALREADY_LIVE : null),
  })
}

// Supersede: deactivate the live version and insert the next one with the new
// terms. Both halves are one transaction — a code must never end up with two
// live versions, nor with none because the insert failed.
export async function createPricingRuleVersion(db, ruleId, body) {
  const existing = await fetchPricingRule(db, ruleId)
  if (!existing) return NOT_FOUND

  const candidate = buildPricingRuleCandidate({ ...body, code: existing.code })
  const error = validatePricingRule(candidate)
  if (error) return badRequest(error)

  return withTransaction(async (client) => {
    const retired = await deactivatePricingRule(client, ruleId)
    if (!retired) {
      abortTransaction(conflict('That pricing rule is no longer live', { code: 'rule_not_live' }))
    }
    return { rule: await insertNextVersion(client, candidate) }
  }, {
    db,
    mapError: (err) => (err.code === '23505' ? CODE_ALREADY_LIVE : null),
  })
}

export async function updatePricingRule(db, ruleId, body) {
  const present = SEMANTIC_FIELDS.filter((field) => field in body)
  if (present.length > 0) {
    return badRequest(
      `Changing ${present.join(', ')} needs a new version so existing price snapshots stay reproducible`,
      { code: 'use_version_endpoint' },
    )
  }

  const fields = []
  const values = []
  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return badRequest('Name is required')
    }
    values.push(body.name)
    fields.push(`name = $${values.length}`)
  }
  if ('is_active' in body) {
    if (typeof body.is_active !== 'boolean') return badRequest('is_active must be a boolean')
    // Reactivation would need the code to be free and is not a real workflow —
    // an admin brings terms back by creating them again as a new version.
    if (body.is_active) return badRequest('A retired pricing rule cannot be reactivated', { code: 'reactivation_unsupported' })
    values.push(false)
    fields.push(`is_active = $${values.length}`)
  }

  if (fields.length === 0) {
    const existing = await fetchPricingRule(db, ruleId)
    return existing ? { rule: existing } : NOT_FOUND
  }

  const rule = await updatePricingRuleCosmetics(db, ruleId, fields, values)
  return rule ? { rule } : NOT_FOUND
}
