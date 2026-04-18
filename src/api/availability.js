async function request(path, options = {}) {
  const res = await fetch(`/api/availability${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (res.status === 204) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const listAvailability = ({ from, to }) =>
  request(`/?from=${from}&to=${to}`)
export const createSlot = (body) => request('/', { method: 'POST', body: JSON.stringify(body) })
export const updateSlot = (id, body) => request(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSlot = (id) => request(`/${id}`, { method: 'DELETE' })
export const getAvailabilityOn = (dateStr) => request(`/on/${dateStr}`)
