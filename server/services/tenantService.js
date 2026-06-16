// Tenant domain logic (global super-admin management). Route handlers stay thin
// and delegate here. Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload.
import pool from '../db/index.js'
import { ALL_ROLES } from '../auth/permissions.js'
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
  userExists,
  insertTenant,
  ensureTenantStatistics,
  insertTenantAdminMembership,
  updateTenantFields,
  upsertTenantAdmin,
  upsertMembership,
  demoteAdminToMember,
  setTenantArchived,
} from '../repositories/tenantRepository.js'

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

function notFound(error) {
  return { error: { status: 404, body: { error } } }
}

function conflict(error) {
  return { error: { status: 409, body: { error } } }
}

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

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    if (adminUserId && !(await userExists(client, adminUserId))) {
      await client.query('ROLLBACK')
      return badRequest('adminUserId references a non-existent user')
    }

    const tenant = await insertTenant(client, slug, band_name, createdByUserId)
    await ensureTenantStatistics(client, tenant.id)
    await seedTenantAccounting(client, tenant.id)

    if (adminUserId) {
      await insertTenantAdminMembership(client, adminUserId, tenant.id, createdByUserId)
    }

    await client.query('COMMIT')
    return { tenant }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return conflict('Slug already in use')
    throw err
  } finally {
    client.release()
  }
}

export async function patchTenant(db, tenantId, body) {
  const built = buildTenantUpdateFields(body)
  if (built.error) return badRequest(built.error)
  if (!built.fields.length) return badRequest('Nothing to update')

  try {
    const tenant = await updateTenantFields(db, tenantId, built.fields, built.values)
    if (!tenant) return notFound('Tenant not found')
    return { tenant }
  } catch (err) {
    if (err.code === '23505') return conflict('Slug already in use')
    throw err
  }
}

export async function addAdmin(db, tenantId, body, actingUserId) {
  const userId = Number(body?.userId)
  if (!Number.isInteger(userId)) return badRequest('userId is required')

  if (!(await fetchTenant(db, tenantId))) return notFound('Tenant not found')
  if (!(await userExists(db, userId))) return notFound('User not found')

  return { membership: await upsertTenantAdmin(db, userId, tenantId, actingUserId) }
}

// Super-admin direct grant: upsert an approved membership in any tenant without
// requiring the user to redeem an invite. `role` defaults to 'member'.
export async function addMembership(db, tenantId, body, actingUserId) {
  const userId = Number(body?.userId)
  const role = body?.role ?? 'member'
  if (!Number.isInteger(userId)) return badRequest('userId is required')
  if (!ALL_ROLES.includes(role)) return badRequest('Invalid role')

  const tenant = await fetchTenantArchiveState(db, tenantId)
  if (!tenant) return notFound('Tenant not found')
  if (tenant.archived_at) return conflict('Tenant is archived')
  if (!(await userExists(db, userId))) return notFound('User not found')

  return { membership: await upsertMembership(db, userId, tenantId, role, actingUserId) }
}

export async function removeAdmin(db, tenantId, userId) {
  const demoted = await demoteAdminToMember(db, tenantId, userId)
  if (!demoted) return notFound('Tenant admin membership not found')
  return {}
}

export async function setArchived(db, tenantId, archived) {
  const tenant = await setTenantArchived(db, tenantId, archived)
  if (!tenant) return notFound('Tenant not found')
  return { tenant }
}
