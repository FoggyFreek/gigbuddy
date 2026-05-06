import { request } from './_client.js'

const api = (path, options) => request(`/api/admin/users${path}`, options)

export const listAllUsers = () => api('/')
export const deleteUserGlobal = (id) => api(`/${id}`, { method: 'DELETE' })
