import { request } from './_client.js'

const api = (path, options) => request(`/api/tasks${path}`, options)

export const listAllTasks = () => api('/')
