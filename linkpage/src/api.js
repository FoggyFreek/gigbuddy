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

// Outbound click beacon (conversion stats). sendBeacon survives the page
// being torn down by the navigation the click just triggered.
export function sendClick(slug, target, { referrer, utmSource }) {
  const url = `/api/pages/${encodeURIComponent(slug)}/click`
  const payload = JSON.stringify({ target, referrer, utmSource })
  try {
    if (navigator.sendBeacon?.(url, new Blob([payload], { type: 'application/json' }))) return
  } catch {
    /* fall through to fetch */
  }
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
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

export function listEditorPages(session) {
  return request('/api/editor/pages', authed(session))
}

export function createReleasePage(session, songId, slug) {
  return request('/api/editor/pages', authed(session, { method: 'POST', body: JSON.stringify({ songId, slug }) }))
}

export function getEditorPage(session, pageId) {
  return request(`/api/editor/pages/${pageId}`, authed(session))
}

export function deleteEditorPage(session, pageId) {
  return request(`/api/editor/pages/${pageId}`, authed(session, { method: 'DELETE' }))
}

export function saveDraft(session, pageId, layout) {
  return request(
    `/api/editor/pages/${pageId}/draft`,
    authed(session, { method: 'PUT', body: JSON.stringify({ layout }) }),
  )
}

export function getPreview(session, pageId) {
  return request(`/api/editor/pages/${pageId}/preview`, authed(session))
}

export function publishPage(session, pageId) {
  return request(`/api/editor/pages/${pageId}/publish`, authed(session, { method: 'POST' }))
}

export function refreshContent(session, pageId) {
  return request(`/api/editor/pages/${pageId}/refresh-content`, authed(session, { method: 'POST' }))
}

export function getStats(session, pageId, days) {
  return request(`/api/editor/pages/${pageId}/stats?days=${days}`, authed(session))
}
