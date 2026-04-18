async function request(path, options = {}) {
  const res = await fetch(`/api/gigs${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (res.status === 204) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const listGigs = () => request('/')
export const getGig = (id) => request(`/${id}`)
export const createGig = (body) => request('/', { method: 'POST', body: JSON.stringify(body) })
export const updateGig = (id, body) => request(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteGig = (id) => request(`/${id}`, { method: 'DELETE' })

export const createTask = (gigId, body) =>
  request(`/${gigId}/tasks`, { method: 'POST', body: JSON.stringify(body) })
export const updateTask = (gigId, taskId, body) =>
  request(`/${gigId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteTask = (gigId, taskId) =>
  request(`/${gigId}/tasks/${taskId}`, { method: 'DELETE' })
