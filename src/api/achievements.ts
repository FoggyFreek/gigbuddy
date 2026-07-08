import { request } from './_client.ts'
import type { Achievement } from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/achievements${path}`, options)

export const listAchievements = () => api<Achievement[]>('/')
