import { request } from './_client.ts'
import type { Id, Task } from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/tasks${path}`, options)

export const listAllTasks = () => api<Task[]>('/')
export const createTask = (body: Partial<Task>) =>
  api<Task>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateTask = (id: Id, body: Partial<Task>) =>
  api<Task>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteTask = (id: Id) =>
  api<void>(`/${id}`, { method: 'DELETE' })
