// Self-service tenant management: any approved user can create tenants they
// own, list them, and archive/unarchive them. The owner's subscription band
// limit caps how many ACTIVE (non-archived) tenants a user owns; archived
// tenants keep their data but don't count. Super-admin tenant management
// (uncapped, ownerless creation) stays in tenantService.js.
//
// Ownership checks return 404, never 403, so tenant existence isn't leaked.
import { validSlug } from '../validators/tenantValidators.js'
import { seedTenantAccounting } from '../db/defaultChartOfAccounts.js'
import {
  insertTenant,
  ensureTenantStatistics,
  insertTenantAdminMembership,
  listOwnedTenants as listOwnedTenantRows,
  fetchOwnedTenant,
  setTenantArchived,
} from '../repositories/tenantRepository.js'
import { enforceBandCap } from './limitService.js'

const NOT_FOUND = { error: { status: 404, body: { error: 'Tenant not found' } } }

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

// Creates a tenant owned by the caller, who becomes its tenant_admin. The
// band cap is checked under a user-row lock in the same transaction as the
// insert, so two parallel creates can't both slip under the limit.
export async function createOwnedTenant(db, userId, body) {
  const { slug, band_name } = body || {}
  if (!validSlug(slug)) return badRequest('Invalid slug')
  if (!band_name || typeof band_name !== 'string') {
    return badRequest('band_name is required')
  }

  const client = await db.connect()
  try {
    await client.query('BEGIN')

    const capError = await enforceBandCap(client, userId)
    if (capError) {
      await client.query('ROLLBACK')
      return capError
    }

    const tenant = await insertTenant(client, slug, band_name, userId, userId)
    await ensureTenantStatistics(client, tenant.id)
    await seedTenantAccounting(client, tenant.id)
    await insertTenantAdminMembership(client, userId, tenant.id, userId)

    await client.query('COMMIT')
    return {
      tenant,
      audit: { action: 'tenant.self_create', details: { tenantId: tenant.id } },
    }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') {
      return { error: { status: 409, body: { error: 'Slug already in use' } } }
    }
    throw err
  } finally {
    client.release()
  }
}

export async function listOwnedTenants(db, userId) {
  return listOwnedTenantRows(db, userId)
}

export async function archiveOwnedTenant(db, userId, tenantId) {
  const tenant = await fetchOwnedTenant(db, tenantId, userId)
  if (!tenant) return NOT_FOUND
  const archived = await setTenantArchived(db, tenantId, true)
  return {
    tenant: archived,
    audit: { action: 'tenant.archive', details: { tenantId } },
  }
}

// Unarchiving makes the tenant active again, so the band cap is re-checked —
// archiving must not be a loophole to park bands above the limit and swap
// them back in.
export async function unarchiveOwnedTenant(db, userId, tenantId) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')

    // Cap first: enforceBandCap locks the user row, serializing this with any
    // concurrent create/unarchive by the same user.
    const capError = await enforceBandCap(client, userId)

    const tenant = await fetchOwnedTenant(client, tenantId, userId)
    if (!tenant) {
      await client.query('ROLLBACK')
      return NOT_FOUND
    }
    if (!tenant.archived_at) {
      await client.query('ROLLBACK')
      return { tenant } // already active — idempotent
    }
    if (capError) {
      await client.query('ROLLBACK')
      return capError
    }

    const unarchived = await setTenantArchived(client, tenantId, false)
    await client.query('COMMIT')
    return {
      tenant: unarchived,
      audit: { action: 'tenant.unarchive', details: { tenantId } },
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
