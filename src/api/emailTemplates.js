import { request } from './_client.js'

const api = (path, options) => request(`/api/email-templates${path}`, options)

export const listEmailTemplates = () => api('/')
export const getEmailTemplate = (id) => api(`/${id}`)
export const createEmailTemplate = (body) =>
  api('/', { method: 'POST', body: JSON.stringify(body) })
export const updateEmailTemplate = (id, body) =>
  api(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteEmailTemplate = (id) =>
  api(`/${id}`, { method: 'DELETE' })
