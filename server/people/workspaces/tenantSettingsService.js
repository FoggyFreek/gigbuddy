import { withTransaction } from '../../db/withTransaction.js'
import { advanceTenantSlug, lockTenantSlug } from './tenantRepository.js'
import { insertSlugSyncOperation } from '../../promotion/linkpage/linkpageSlugSyncRepository.js'
import { parseTenantSlugChange } from './tenantValidators.js'
import { attemptEligibleLinkpageSlugSync } from '../../promotion/linkpage/linkpageSlugSyncService.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'
import { logger } from '../../utils/logger.js'

export async function changeTenantSlug(db, tenantId, body) {
  const parsed = parseTenantSlugChange(body)
  if (parsed.error) return badRequest(parsed.error, { code: parsed.code })

  const result = await withTransaction(async (client) => {
    const current = await lockTenantSlug(client, tenantId)
    if (!current) return notFound('Tenant not found')
    if (current.slug === parsed.slug) return { slug: current.slug }

    const tenant = await advanceTenantSlug(client, tenantId, parsed.slug)
    const operation = await insertSlugSyncOperation(client, {
      tenantId,
      oldSlug: current.slug,
      newSlug: tenant.slug,
      slugRevision: tenant.slug_revision,
    })
    return {
      slug: tenant.slug,
      operation,
      audit: { action: 'tenant.slug.update' },
    }
  }, {
    db,
    mapError: (err) => err.code === '23505'
      ? conflict('Slug already in use', { code: 'slug_in_use' })
      : null,
  })

  if (result.error || !result.operation) return result

  try {
    const delivery = await attemptEligibleLinkpageSlugSync(db, result.operation.id)
    return { ...result, linkpageSync: delivery.sync }
  } catch (err) {
    logger.error('linkpage.slug_sync_immediate_failed', {
      err,
      operationId: result.operation.id,
      tenantId,
      revision: Number(result.operation.slug_revision),
      attemptCount: result.operation.attempt_count,
    })
    return { ...result, linkpageSync: 'pending' }
  }
}
