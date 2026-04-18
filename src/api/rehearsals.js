async function request(path, options = {}) {
  const res = await fetch(`/api/rehearsals${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (res.status === 204) return null
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const listRehearsals = () => request('/')
export const getRehearsal = (id) => request(`/${id}`)
export const createRehearsal = (body) =>
  request('/', { method: 'POST', body: JSON.stringify(body) })
export const updateRehearsal = (id, body) =>
  request(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteRehearsal = (id) =>
  request(`/${id}`, { method: 'DELETE' })

export const addParticipant = (id, bandMemberId) =>
  request(`/${id}/participants`, {
    method: 'POST',
    body: JSON.stringify({ band_member_id: bandMemberId }),
  })
export const removeParticipant = (id, bandMemberId) =>
  request(`/${id}/participants/${bandMemberId}`, { method: 'DELETE' })
export const setVote = (id, bandMemberId, vote) =>
  request(`/${id}/participants/${bandMemberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ vote }),
  })
