import { request } from './_client.js'

const api = (path, options) => request(`/api/band-members${path}`, options)

export const listMembers = () => api('/')
export const createMember = (body) => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateMember = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteMember = (id) => api(`/${id}`, { method: 'DELETE' })
