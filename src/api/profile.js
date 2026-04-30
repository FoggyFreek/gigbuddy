import { request, requestForm } from './_client.js'

const api = (path, options) => request(`/api/profile${path}`, options)

export const getProfile = () => api('/')
export const updateProfile = (body) => api('/', { method: 'PATCH', body: JSON.stringify(body) })

export const createLink = (body) =>
  api('/links', { method: 'POST', body: JSON.stringify(body) })
export const updateLink = (linkId, body) =>
  api(`/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteLink = (linkId) =>
  api(`/links/${linkId}`, { method: 'DELETE' })

export function uploadLogo(file) {
  const fd = new FormData()
  fd.append('logo', file)
  return requestForm('/api/profile/logo', fd)
}
