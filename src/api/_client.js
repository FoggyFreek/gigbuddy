let csrfToken = null

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function request(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (!SAFE_METHODS.has(method) && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken
  }

  const res = await fetch(url, { ...options, headers })

  const responseToken = res.headers.get('X-CSRF-Token')
  if (responseToken) csrfToken = responseToken

  if (res.status === 204) return null
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
    const data = await res.json().catch(() => ({}))
    throw Object.assign(new Error(data.error || 'Unauthorized'), { status: 401 })
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}
