// Tenant domain logic (global super-admin management). Route handlers stay thin
// and delegate here. Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload.
import { withTransaction, abortTransaction } from '../db/withTransaction.js'
import { WRITE_ROLES } from '../auth/permissions.js'
import { seedTenantAccounting } from '../db/defaultChartOfAccounts.js'
import {
  validSlug,
  buildTenantUpdateFields,
  resolveAdminUserId,
} from '../validators/tenantValidators.js'
import {
  listTenantsWithMemberCount,
  fetchTenant,
  fetchTenantArchiveState,
  fetchMembershipStatus,
  userExists,
  insertTenant,
  ensureTenantStatistics,
  insertTenantAdminMembership,
  updateTenantFields,
  upsertTenantAdmin,
  upsertMembership,
  demoteAdminToContributor,
  setTenantArchived,
  fetchTenantForDeletion,
  fetchTenantAssetKeys,
  deleteTenantRow,
} from '../repositories/tenantRepository.js'
import { deleteTenantObjects } from './storageService.js'
import { enforceMemberCap } from './limitService.js'
import { logger } from '../utils/logger.js'
import { badRequest, conflict, notFound } from './serviceErrors.js'

// ---------- reads ----------

export async function listTenants(db) {
  return listTenantsWithMemberCount(db)
}

export async function getTenant(db, tenantId) {
  const tenant = await fetchTenant(db, tenantId)
  if (!tenant) return notFound('Tenant not found')
  return { tenant }
}

// ---------- writes ----------

// Creates a tenant plus its stats row, default chart of accounts, and (unless
// adminUserId is null) an approved tenant_admin membership, all in one
// transaction. createdByUserId is the acting super admin.
export async function createTenant(createdByUserId, body) {
  const { slug, band_name } = body || {}
  if (!validSlug(slug)) return badRequest('Invalid slug')
  if (!band_name || typeof band_name !== 'string') {
    return badRequest('band_name is required')
  }
  const resolved = resolveAdminUserId(body, createdByUserId)
  if (resolved.error) return badRequest(resolved.error)
  const { adminUserId } = resolved

  return withTransaction(async (client) => {
    if (adminUserId && !(await userExists(client, adminUserId))) {
      abortTransaction(badRequest('adminUserId references a non-existent user'))
    }

    const tenant = await insertTenant(client, slug, band_name, createdByUserId)
    await ensureTenantStatistics(client, tenant.id)
    await seedTenantAccounting(client, tenant.id)

    if (adminUserId) {
      await insertTenantAdminMembership(client, adminUserId, tenant.id, createdByUserId)
    }

    return { tenant }
  }, {
    mapError: (err) => (err.code === '23505' ? conflict('Slug already in use') : null),
  })
}

// Owner assignment validation: null (detach) is always allowed; a non-null id
// must be a positive integer referencing an existing user. Returns the error
// message or null.
async function ownerFieldError(db, ownerUserId) {
  if (ownerUserId === null) return null
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
    return 'owner_user_id must be an integer or null'
  }
  if (!(await userExists(db, ownerUserId))) {
    return 'owner_user_id references a non-existent user'
  }
  return null
}

export async function patchTenant(db, tenantId, body) {
  const built = buildTenantUpdateFields(body)
  if (built.error) return badRequest(built.error)

  // Owner assignment (super-admin only route): migrates legacy tenants into
  // the subscription model. null detaches the owner (back to no enforcement).
  const hasOwnerField = body && Object.hasOwn(body, 'owner_user_id')
  if (hasOwnerField) {
    const error = await ownerFieldError(db, body.owner_user_id)
    if (error) return badRequest(error)
    built.fields.push(`owner_user_id = $${built.values.length + 1}`)
    built.values.push(body.owner_user_id)
  }

  if (!built.fields.length) return badRequest('Nothing to update')

  try {
    const tenant = await updateTenantFields(db, tenantId, built.fields, built.values)
    if (!tenant) return notFound('Tenant not found')
    const result = { tenant }
    if (hasOwnerField) {
      result.audit = {
        action: 'tenant.owner_assigned',
        details: { tenantId, ownerUserId: body.owner_user_id },
      }
    }
    return result
  } catch (err) {
    if (err.code === '23505') return conflict('Slug already in use')
    throw err
  }
}

// Upserts an approved membership inside a transaction, enforcing the member
// cap when the grant creates a NEW approved membership (a promote/role change
// of an already-approved member consumes no extra capacity).
async function grantApprovedMembership(db, tenantId, userId, upsertFn) {
  return withTransaction(async (client) => {
    const existingStatus = await fetchMembershipStatus(client, userId, tenantId)
    if (existingStatus !== 'approved') {
      const capError = await enforceMemberCap(client, tenantId, 'membership')
      if (capError) abortTransaction(capError)
    }
    return { membership: await upsertFn(client) }
  }, { db })
}

export async function addAdmin(db, tenantId, body, actingUserId) {
  const userId = Number(body?.userId)
  if (!Number.isInteger(userId)) return badRequest('userId is required')

  if (!(await fetchTenant(db, tenantId))) return notFound('Tenant not found')
  if (!(await userExists(db, userId))) return notFound('User not found')

  return grantApprovedMembership(db, tenantId, userId, (client) =>
    upsertTenantAdmin(client, userId, tenantId, actingUserId))
}

// Super-admin direct grant: upsert an approved membership in any tenant without
// requiring the user to redeem an invite. `role` defaults to 'contributor'.
export async function addMembership(db, tenantId, body, actingUserId) {
  const userId = Number(body?.userId)
  const role = body?.role ?? 'contributor'
  if (!Number.isInteger(userId)) return badRequest('userId is required')
  if (!WRITE_ROLES.includes(role)) return badRequest('Invalid role')

  const tenant = await fetchTenantArchiveState(db, tenantId)
  if (!tenant) return notFound('Tenant not found')
  if (tenant.archived_at) return conflict('Tenant is archived')
  if (!(await userExists(db, userId))) return notFound('User not found')

  return grantApprovedMembership(db, tenantId, userId, (client) =>
    upsertMembership(client, userId, tenantId, role, actingUserId))
}

export async function removeAdmin(db, tenantId, userId) {
  const demoted = await demoteAdminToContributor(db, tenantId, userId)
  if (!demoted) return notFound('Tenant admin membership not found')
  return {}
}

export async function setArchived(db, tenantId, archived) {
  const tenant = await setTenantArchived(db, tenantId, archived)
  if (!tenant) return notFound('Tenant not found')
  return { tenant }
}

export async function deleteTenant(db, tenantId, confirmationSlug) {
  return withTransaction(async (client) => {
    const tenant = await fetchTenantForDeletion(client, tenantId)
    if (!tenant) abortTransaction(notFound('Tenant not found'))
    if (!tenant.archived_at) abortTransaction(conflict('Tenant must be archived before deletion'))
    if (confirmationSlug !== tenant.slug) abortTransaction(badRequest('Confirmation slug does not match'))

    const assetKeys = await fetchTenantAssetKeys(client, tenantId)
    try {
      await deleteTenantObjects(tenantId, assetKeys)
    } catch (err) {
      logger.error('tenant.delete_storage_failed', { err, tenantId })
      abortTransaction({ error: { status: 502, body: { error: 'Failed to delete tenant storage' } } })
    }

    await deleteTenantRow(client, tenantId)
    return { audit: { action: 'tenant.delete', details: { tenantId } } }
  }, { db })
}
