import { request } from './_client.ts'
import type { Id, Task } from '../types/entities.ts'
import type { LimitedCollectionWithTotalResponse } from '../types/api.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/tasks${path}`, options)

interface TaskListFilters {
  limit?: number
  assignee?: 'me' | Id
  done?: boolean
}

export const listTasks = ({ limit, assignee, done }: TaskListFilters = {}) => {
  const params = new URLSearchParams()
  if (limit !== undefined) params.set('limit', String(limit))
  if (assignee !== undefined) params.set('assignee', String(assignee))
  if (done !== undefined) params.set('done', String(done))
  return api<LimitedCollectionWithTotalResponse<Task>>(`/?${params}`)
}
export const createTask = (body: Partial<Task>) =>
  api<Task>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateTask = (id: Id, body: Partial<Task>) =>
  api<Task>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteTask = (id: Id) =>
  api<void>(`/${id}`, { method: 'DELETE' })
