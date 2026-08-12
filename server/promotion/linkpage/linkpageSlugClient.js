const SUCCESS_CODES = new Set(['applied', 'already_applied', 'no_pages', 'stale_ignored'])
const CONFLICT_CODES = new Set(['slug_conflict', 'revision_gap'])
const DEFAULT_TIMEOUT_MS = 3000

function integrationOrigin() {
  return process.env.LINKPAGE_URL || null
}

function configured() {
  return Boolean(process.env.LINKPAGE_SECRET && integrationOrigin())
}

async function responseCode(response) {
  try {
    const body = await response.json()
    return typeof body?.code === 'string' ? body.code
      : typeof body?.status === 'string' ? body.status
        : null
  } catch {
    return null
  }
}

function failureCode(status, code) {
  if (status === 401) return 'unauthorized'
  if (status === 409 && CONFLICT_CODES.has(code)) return code
  if (status === 400) return 'bad_request'
  if (status >= 500) return 'server_error'
  return status === 409 ? 'conflict' : `http_${status}`
}

export async function deliverLinkpageSlugOperation(operation, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!configured()) return { ok: false, code: 'not_configured' }

  const revision = Number(operation.slug_revision)
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    return { ok: false, code: 'invalid_operation' }
  }

  const origin = integrationOrigin().replace(/\/$/, '')
  const url = `${origin}/api/integrations/gigbuddy/tenants/${operation.tenant_id}/slug`

  try {
    const response = await fetchImpl(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${process.env.LINKPAGE_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        oldSlug: operation.old_slug,
        newSlug: operation.new_slug,
        revision,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const code = await responseCode(response)
    if (response.status === 200 && SUCCESS_CODES.has(code)) return { ok: true, code }
    if (response.status === 200) return { ok: false, code: 'malformed_response' }
    return { ok: false, code: failureCode(response.status, code) }
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return { ok: false, code: 'timeout' }
    }
    return { ok: false, code: 'network_error' }
  }
}
