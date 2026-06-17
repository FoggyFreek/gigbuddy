// Shopify Admin REST API client for order import. The only module that talks to
// Shopify over HTTP — isolating it keeps a later GraphQL migration to one file
// (REST is Shopify-legacy as of Oct 1 2024). Reads the per-tenant token + store
// domain (085/086/087) and never returns the token to callers.
//
// Errors map to the standard { error: { status, body } } contract so routes can
// translate them directly. The access token is minted on demand from the tenant's
// app credentials by shopifyTokenService (client_credentials grant).
import { listImportedLineIds } from '../repositories/shopifyImportRepository.js'
import { getAccessToken, invalidateToken } from './shopifyTokenService.js'
import { orderSkipReason, lineSkipReason, currentQuantity } from './shopifyImportMapping.js'

export const SHOPIFY_API_VERSION = '2026-01'
const MAX_IDS_PER_REQUEST = 250

function shopifyError(status, error, extra = {}) {
  return { error: { status, body: { error, ...extra } } }
}

// One authenticated GET against the Admin API. Returns { body, link } on success,
// or { error } mapping the upstream failure (401 unauthorized, 429 rate-limited
// with Retry-After). On 401 the cached token is dropped so the next call re-mints.
async function shopifyGet(tenantId, domain, token, path, fetchImpl) {
  const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}${path}`
  let res
  try {
    res = await fetchImpl(url, {
      headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' },
    })
  } catch {
    return shopifyError(502, 'shopify_unreachable')
  }
  if (res.status === 401) {
    // 400 (not 401) so the SPA's session-expiry handler doesn't log the user out;
    // a rejected token usually means the app is missing the read_orders scope.
    invalidateToken(tenantId)
    return shopifyError(400, 'shopify_unauthorized', {
      message: 'Shopify rejected the access token. Make sure the app has the read_orders scope.',
    })
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After')) || null
    return shopifyError(429, 'shopify_rate_limited', { retry_after: retryAfter })
  }
  if (!res.ok) return shopifyError(502, 'shopify_error', { upstream_status: res.status })
  const body = await res.json()
  return { body, link: res.headers.get('Link') || res.headers.get('link') || null }
}

// Extracts the page_info cursor from the rel="next" entry of a Link header.
function parseNextPageInfo(linkHeader) {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="?next"?/)
    if (match) {
      try {
        return new URL(match[1]).searchParams.get('page_info')
      } catch {
        return null
      }
    }
  }
  return null
}

// Slim DTO. Keeps the effective/current fields the monetary helper needs
// (current_quantity, price, total_discount, discount_allocations) so import can
// recompute amounts authoritatively. Shopify ids are stringified (bigints).
function toSlimOrder(order) {
  return {
    id: String(order.id),
    name: order.name,
    created_at: order.created_at,
    processed_at: order.processed_at,
    financial_status: order.financial_status,
    fulfillment_status: order.fulfillment_status,
    cancelled_at: order.cancelled_at ?? null,
    currency: order.currency,
    taxes_included: Boolean(order.taxes_included),
    total_incl_cents: Math.round(Number(order.current_total_price ?? order.total_price ?? 0) * 100),
    line_items: (order.line_items || []).map((li) => ({
      id: String(li.id),
      title: li.title,
      sku: li.sku ?? null,
      quantity: li.quantity,
      current_quantity: currentQuantity(li),
      price: li.price,
      total_discount: li.total_discount,
      discount_allocations: li.discount_allocations ?? [],
    })),
  }
}

// Adds UI flags to a slim order: per-line already-imported + skip reason, the
// order-level eligibility reason, and fully_imported (every importable line
// already tracked). `importedLineIds` is a Set of shopify_line_id.
function annotate(order, importedLineIds) {
  const skip_reason = orderSkipReason(order)
  const line_items = order.line_items.map((line) => ({
    ...line,
    already_imported: importedLineIds.has(line.id),
    skip_reason: lineSkipReason(line),
  }))
  const importable = line_items.filter((l) => !l.skip_reason)
  const fully_imported = !skip_reason
    && importable.length > 0
    && importable.every((l) => l.already_imported)
  return { ...order, line_items, skip_reason, fully_imported }
}

// Recent orders for the import picker. First page sends status=any&limit;
// subsequent pages send ONLY page_info (+limit) — page_info can't be combined
// with status/date filters. Returns { orders, nextCursor }.
export async function fetchRecentOrders(executor, tenantId, { cursor, limit = 50 } = {}, fetchImpl = globalThis.fetch) {
  const creds = await getAccessToken(executor, tenantId, fetchImpl)
  if (creds.error) return creds

  const limitNum = Math.min(Math.max(Number(limit) || 50, 1), MAX_IDS_PER_REQUEST)
  const params = new URLSearchParams({ limit: String(limitNum) })
  if (cursor) params.set('page_info', cursor)
  else params.set('status', 'any')

  const result = await shopifyGet(tenantId, creds.domain, creds.token, `/orders.json?${params}`, fetchImpl)
  if (result.error) return result

  const orders = (result.body.orders || []).map(toSlimOrder)
  const importedLineIds = await listImportedLineIds(executor, tenantId, orders.map((o) => o.id))
  return {
    orders: orders.map((o) => annotate(o, importedLineIds)),
    nextCursor: parseNextPageInfo(result.link),
  }
}

// Authoritative re-fetch of specific orders by id (used at import time so amounts
// come from Shopify, not the client). Chunks ids to Shopify's max of 250.
export async function fetchOrdersByIds(executor, tenantId, ids, fetchImpl = globalThis.fetch) {
  const creds = await getAccessToken(executor, tenantId, fetchImpl)
  if (creds.error) return creds

  const unique = [...new Set(ids.map(String))]
  const orders = []
  for (let i = 0; i < unique.length; i += MAX_IDS_PER_REQUEST) {
    const chunk = unique.slice(i, i + MAX_IDS_PER_REQUEST)
    const params = new URLSearchParams({ status: 'any', limit: String(MAX_IDS_PER_REQUEST), ids: chunk.join(',') })
    const result = await shopifyGet(tenantId, creds.domain, creds.token, `/orders.json?${params}`, fetchImpl)
    if (result.error) return result
    orders.push(...(result.body.orders || []).map(toSlimOrder))
  }
  return { orders }
}
