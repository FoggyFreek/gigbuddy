import { request, requestForm } from './_client.js'

export const getSharePhotos = () => request('/api/share/photos')

export function uploadSharePhoto(file) {
  const fd = new FormData()
  fd.append('photo', file)
  return requestForm('/api/share/photos', fd)
}

export const deleteSharePhoto = (id) =>
  request(`/api/share/photos/${id}`, { method: 'DELETE' })
