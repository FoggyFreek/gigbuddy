async function request(path, options = {}) {
  const res = await fetch(`/api/profile${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (res.status === 204) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const getProfile = () => request('/')
export const updateProfile = (body) => request('/', { method: 'PATCH', body: JSON.stringify(body) })

export const createLink = (body) =>
  request('/links', { method: 'POST', body: JSON.stringify(body) })
export const updateLink = (linkId, body) =>
  request(`/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteLink = (linkId) =>
  request(`/links/${linkId}`, { method: 'DELETE' })
