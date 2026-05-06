import { request } from './_client.js'

export const getCurrentUser = () => request('/api/auth/me')
export const logout = () => request('/api/auth/logout', { method: 'POST' })
export const setActiveTenant = (tenantId) =>
  request('/api/auth/active-tenant', {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  })
