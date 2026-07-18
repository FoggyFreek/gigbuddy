// Thin fetch wrappers — the only place that knows /api paths. The editor
// session token lives in sessionStorage (editor surface only; the public
// page stores nothing on the visitor's device).

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  if (res.status === 204) return null
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return body
}

// ---------- public ----------

export function getPublicPage(slug) {
  return request(`/api/pages/${encodeURIComponent(slug)}`)
}

// Fire-and-forget view beacon; failures must never affect the visitor.
export function sendView(slug, { referrer, utmSource }) {
  return request(`/api/pages/${encodeURIComponent(slug)}/view`, {
    method: 'POST',
    body: JSON.stringify({ referrer, utmSource }),
  }).catch(() => null)
}

// ---------- editor ----------

const SESSION_KEY = 'lp_editor_session'

export function getStoredSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

export function storeSession(token) {
  try {
    sessionStorage.setItem(SESSION_KEY, token)
  } catch {
    /* private mode — the session just won't survive a reload */
  }
}

function authed(session, options = {}) {
  return { ...options, headers: { Authorization: `Bearer ${session}`, ...(options.headers || {}) } }
}

export function exchangeHandoff(token) {
  return request('/api/editor/session', { method: 'POST', body: JSON.stringify({ token }) })
}

export function getEditorPage(session) {
  return request('/api/editor/page', authed(session))
}

export function saveDraft(session, layout) {
  return request('/api/editor/draft', authed(session, { method: 'PUT', body: JSON.stringify({ layout }) }))
}

export function getPreview(session) {
  return request('/api/editor/preview', authed(session))
}

export function publishPage(session) {
  return request('/api/editor/publish', authed(session, { method: 'POST' }))
}

export function refreshContent(session) {
  return request('/api/editor/refresh-content', authed(session, { method: 'POST' }))
}

export function getStats(session, days) {
  return request(`/api/editor/stats?days=${days}`, authed(session))
}
