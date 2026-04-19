import { request } from './_client.js'

const api = (path, options) => request(`/api/availability${path}`, options)

export const listAvailability = ({ from, to }) => api(`/?from=${from}&to=${to}`)
export const createSlot = (body) => api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateSlot = (id, body) => api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSlot = (id) => api(`/${id}`, { method: 'DELETE' })
export const getAvailabilityOn = (dateStr) => api(`/on/${dateStr}`)
