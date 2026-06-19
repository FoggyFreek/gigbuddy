import { request } from './_client.ts'

/** One file-search result. `to` is the detail route of the owning gig/song. */
export interface FileSearchResult {
  id: string
  filename: string
  kind: string
  to: string
}

// Global file search (min 3 chars) across the non-financial attachment tables.
export const searchFiles = (q: string) =>
  request<FileSearchResult[]>(`/api/files/search?${new URLSearchParams({ q })}`)
