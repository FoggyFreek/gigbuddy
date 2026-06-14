import { request } from './_client.ts'
import type { Id } from '../types/entities.ts'

interface Task {
  id?: Id
  gig_id?: Id
  title?: string
  done?: boolean
  assigned_to?: Id
  due_date?: string
  gig_date?: string
  gig_description?: string
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/tasks${path}`, options)

export const listAllTasks = () => api<Task[]>('/')
