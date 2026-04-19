import { request } from './_client.js'

export const getCurrentUser = () => request('/api/auth/me')
export const logout = () => request('/api/auth/logout', { method: 'POST' })
