// Mints short-lived Shopify Admin API access tokens via the client_credentials
// grant (POST https://{shop}/admin/oauth/access_token) and caches them in memory
// per tenant. Tokens last ~24h; we re-mint when missing or within a safety
// window of expiry. Storing only the app's Client ID + secret (not a long-lived
// token) follows Shopify's Dev Dashboard guidance.
import {
  getShopifyClientId,
  getShopifyClientSecret,
  getShopifyDomain,
} from '../repositories/profileRepository.js'

// Re-mint this many ms before the real expiry so an in-flight request never uses
// an about-to-expire token.
const EXPIRY_BUFFER_MS = 60_000

// tenantId → { token, expiresAt }
const cache = new Map()

function shopifyError(status, error, extra = {}) {
  return { error: { status, body: { error, ...extra } } }
}

// Drops a tenant's cached token (e.g. after a 401 so the next call re-mints).
export function invalidateToken(tenantId) {
  cache.delete(tenantId)
}

export function resetShopifyTokenCacheForTests() {
  cache.clear()
}

// Returns { token } for the tenant, minting + caching as needed, or { error }
// in the standard contract (shopify_not_configured / shopify_unauthorized / …).
export async function getAccessToken(executor, tenantId, fetchImpl = globalThis.fetch) {
  const cached = cache.get(tenantId)
  if (cached && cached.expiresAt > Date.now()) return { token: cached.token, domain: cached.domain }

  const [domain, clientId, clientSecret] = await Promise.all([
    getShopifyDomain(executor, tenantId),
    getShopifyClientId(executor, tenantId),
    getShopifyClientSecret(executor, tenantId),
  ])
  if (!domain || !clientId || !clientSecret) return shopifyError(400, 'shopify_not_configured')

  const url = `https://${domain}/admin/oauth/access_token`
  let res
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
  } catch {
    return shopifyError(502, 'shopify_unreachable')
  }
  if (!res.ok) {
    // Surface Shopify's own error so the user knows what to fix (e.g.
    // app_not_installed, invalid_client). Use 400 — never 401, which the SPA
    // treats as a session expiry and would log the user out.
    const detail = await res.json().catch(() => ({}))
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return shopifyError(400, 'shopify_auth_failed', {
        code: detail?.error ?? null,
        message: detail?.error_description ?? null,
      })
    }
    return shopifyError(502, 'shopify_error', { upstream_status: res.status })
  }

  const body = await res.json()
  const token = body?.access_token
  if (!token) return shopifyError(502, 'shopify_error')
  const ttlMs = (Number(body.expires_in) || 86_400) * 1000
  cache.set(tenantId, { token, domain, expiresAt: Date.now() + ttlMs - EXPIRY_BUFFER_MS })
  return { token, domain }
}
