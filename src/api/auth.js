async function request(path, options = {}) {
  const res = await fetch(`/api/auth${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
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

export const getCurrentUser = () => request('/me')
export const logout = () =>
  fetch('/api/auth/logout', { method: 'POST' }).then(() => null)
