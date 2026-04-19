import { request } from './_client.js'

const api = (path, options) => request(`/api/users${path}`, options)

export const listUsers = () => api('/')
export const updateUser = (id, patch) =>
  api(`/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const deleteUser = (id) => api(`/${id}`, { method: 'DELETE' })
