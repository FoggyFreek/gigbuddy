import { request } from './_client.js'

const api = (path, options) => request(`/api/gigs${path}`, options)

export const listGigs = () => api('/')
export const getGig = (id) => api(`/${id}`)
export const createGig = (body) => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateGig = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteGig = (id) => api(`/${id}`, { method: 'DELETE' })

export const createTask = (gigId, body) =>
  api(`/${gigId}/tasks`, { method: 'POST', body: JSON.stringify(body) })
export const updateTask = (gigId, taskId, body) =>
  api(`/${gigId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteTask = (gigId, taskId) =>
  api(`/${gigId}/tasks/${taskId}`, { method: 'DELETE' })
