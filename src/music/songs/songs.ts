import { request, requestForm } from '../../api/_client.ts'
import type { Song, SongTag, SongLink, SongFile, SongChart, Album, Id } from '../../types/entities.ts'
import type { LimitedCollectionResponse } from '../../types/api.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/songs${path}`, options)

export const listSongs = () => api<Song[]>('/')
export const getSong = (id: Id) => api<Song>(`/${id}`)
export const createSong = (body: Partial<Song>) =>
  api<Song>('/', { method: 'POST', body: JSON.stringify(body) })
export const updateSong = (id: Id, body: Partial<Song>) =>
  api<Song>(`/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSong = (id: Id) => api<void>(`/${id}`, { method: 'DELETE' })
export const importSongs = (rows: Partial<Song>[]) =>
  api<Song[]>('/import', { method: 'POST', body: JSON.stringify(rows) })

export const searchSongs = (q: string) =>
  api<Song[]>(`/search?${new URLSearchParams({ q: q ?? '' })}`)

export const listAlbums = async (q: string) => {
  const response = await api<LimitedCollectionResponse<Album>>(
    `/albums?${new URLSearchParams({ q: q ?? '', limit: '25' })}`,
  )
  return response.items
}
export const createAlbum = (body: Partial<Album>) =>
  api<Album>('/albums', { method: 'POST', body: JSON.stringify(body) })
export const updateAlbum = (id: Id, body: Partial<Album>) =>
  api<Album>(`/albums/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const uploadAlbumArt = (id: Id, file: File) => {
  const fd = new FormData()
  fd.append('art', file)
  return requestForm<Album>(`/api/songs/albums/${id}/art`, fd)
}
export const deleteAlbumArt = (id: Id) =>
  api<Album>(`/albums/${id}/art`, { method: 'DELETE' })
export const setSongCoverFromAlbum = (songId: Id, albumId: Id) =>
  api<{ cover_image_path: string }>(`/${songId}/cover/from-album`, {
    method: 'POST',
    body: JSON.stringify({ album_id: albumId }),
  })

export const searchSongTags = (q: string) =>
  api<SongTag[]>(`/tags?${new URLSearchParams({ q: q ?? '' })}`)
export const setSongTags = (id: Id, tags: string[]) =>
  api<Song>(`/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tags }) })

export const addSongLink = (id: Id, body: Partial<SongLink>) =>
  api<SongLink>(`/${id}/links`, { method: 'POST', body: JSON.stringify(body) })
export const updateSongLink = (id: Id, linkId: Id, body: Partial<SongLink>) =>
  api<SongLink>(`/${id}/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSongLink = (id: Id, linkId: Id) =>
  api<void>(`/${id}/links/${linkId}`, { method: 'DELETE' })

export const uploadSongDocument = (id: Id, file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return requestForm<SongFile>(`/api/songs/${id}/documents`, fd)
}
export const deleteSongDocument = (id: Id, docId: Id) =>
  api<void>(`/${id}/documents/${docId}`, { method: 'DELETE' })

export const uploadSongRecording = (id: Id, file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return requestForm<SongFile>(`/api/songs/${id}/recordings`, fd)
}
export const deleteSongRecording = (id: Id, recId: Id) =>
  api<void>(`/${id}/recordings/${recId}`, { method: 'DELETE' })

export const uploadSongCover = (id: Id, file: File) => {
  const fd = new FormData()
  fd.append('cover', file)
  return requestForm<{ cover_image_path: string | null }>(`/api/songs/${id}/cover`, fd)
}
export const deleteSongCover = (id: Id) =>
  api<void>(`/${id}/cover`, { method: 'DELETE' })

export const createSongChart = (id: Id, body: Partial<SongChart>) =>
  api<SongChart>(`/${id}/charts`, { method: 'POST', body: JSON.stringify(body) })
export const uploadSongChart = (id: Id, file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return requestForm<SongChart>(`/api/songs/${id}/charts/upload`, fd)
}
export const updateSongChart = (id: Id, chartId: Id, body: Partial<SongChart>) =>
  api<SongChart>(`/${id}/charts/${chartId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteSongChart = (id: Id, chartId: Id) =>
  api<void>(`/${id}/charts/${chartId}`, { method: 'DELETE' })
