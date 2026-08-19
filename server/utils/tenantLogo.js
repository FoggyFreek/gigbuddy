// Loads the tenant logo a generated document draws into its header. Shared by
// every PDF renderer so they all resolve the same way and all fail the same
// way: a logo that cannot be fetched is left out, never fatal — the document is
// still correct without it.
//
// `logo_dark_path` is the darker variant a tenant uploads for dark backgrounds;
// documents that ask for it fall back to the ordinary logo when none exists.
import { readObjectBuffer } from '../platform/files/storageService.js'
import { logger } from './logger.js'

export async function loadTenantLogoBuffer(tenant, { customLogoPath = null, preferDark = false } = {}) {
  const key = customLogoPath
    || (preferDark && tenant?.logo_dark_path ? tenant.logo_dark_path : tenant?.logo_path)
  if (!key) return null
  try {
    return await readObjectBuffer(key)
  } catch (err) {
    logger.error('document.logo_load_failed', { err })
    return null
  }
}
