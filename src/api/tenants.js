import { request } from './_client.js'

const api = (path, options) => request(`/api/admin/tenants${path}`, options)

export const listTenants = () => api('/')
export const getTenant = (id) => api(`/${id}`)
export const createTenant = (payload) =>
  api('/', { method: 'POST', body: JSON.stringify(payload) })
export const updateTenant = (id, patch) =>
  api(`/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const assignTenantAdmin = (id, userId) =>
  api(`/${id}/admins`, { method: 'POST', body: JSON.stringify({ userId }) })
export const demoteTenantAdmin = (id, userId) =>
  api(`/${id}/admins/${userId}`, { method: 'DELETE' })
export const grantMembership = (id, payload) =>
  api(`/${id}/memberships`, { method: 'POST', body: JSON.stringify(payload) })
export const archiveTenant = (id) =>
  api(`/${id}/archive`, { method: 'POST' })
export const unarchiveTenant = (id) =>
  api(`/${id}/unarchive`, { method: 'POST' })
