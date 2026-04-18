async function request(path, options = {}) {
  const res = await fetch(`/api/users${path}`, {
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

export const listUsers = () => request('/')
export const updateUser = (id, patch) =>
  request(`/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const deleteUser = (id) => request(`/${id}`, { method: 'DELETE' })
