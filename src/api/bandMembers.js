async function request(path, options = {}) {
  const res = await fetch(`/api/band-members${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (res.status === 204) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const listMembers = () => request('/')
export const createMember = (body) => request('/', { method: 'POST', body: JSON.stringify(body) })
export const updateMember = (id, body) => request(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteMember = (id) => request(`/${id}`, { method: 'DELETE' })
