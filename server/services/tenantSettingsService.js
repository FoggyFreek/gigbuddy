import { updateTenantSlug } from '../repositories/tenantRepository.js'
import { parseTenantSlugChange } from '../validators/tenantValidators.js'
import { badRequest, conflict, notFound } from './serviceErrors.js'

export async function changeTenantSlug(db, tenantId, body) {
  const parsed = parseTenantSlugChange(body)
  if (parsed.error) return badRequest(parsed.error, { code: parsed.code })

  try {
    const tenant = await updateTenantSlug(db, tenantId, parsed.slug)
    if (!tenant) return notFound('Tenant not found')
    return {
      slug: tenant.slug,
      audit: { action: 'tenant.slug.update' },
    }
  } catch (err) {
    if (err.code === '23505') {
      return conflict('Slug already in use', { code: 'slug_in_use' })
    }
    throw err
  }
}
