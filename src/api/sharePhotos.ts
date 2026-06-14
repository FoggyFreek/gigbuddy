import { request, requestForm } from './_client.ts'
import type { Id } from '../types/entities.ts'

interface SharePhoto {
  id?: Id
  object_key?: string
  original_filename?: string
  content_type?: string
  file_size?: number
  uploaded_at?: string
  url?: string
}

export const getSharePhotos = () => request<SharePhoto[]>('/api/share/photos')

export function uploadSharePhoto(file: File) {
  const fd = new FormData()
  fd.append('photo', file)
  return requestForm<SharePhoto>('/api/share/photos', fd)
}

export const deleteSharePhoto = (id: Id) =>
  request<void>(`/api/share/photos/${id}`, { method: 'DELETE' })
