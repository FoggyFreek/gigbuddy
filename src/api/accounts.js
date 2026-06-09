import { request } from './_client.js'

const api = (path, options) => request(`/api/accounts${path}`, options)

export const listAccounts = () => api('/')
export const createAccount = (body) => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateAccount = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteAccount = (id) => api(`/${id}`, { method: 'DELETE' })
export const getAccountingSettings = () => api('/settings')
export const updateAccountingSettings = (body) => api('/settings', { method: 'PATCH', body: JSON.stringify(body) })
