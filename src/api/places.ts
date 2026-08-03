import { request } from './_client.ts'
import type { PlaceSuggestion, PlaceSearchResponse } from '../types/api.ts'

export interface PlaceSearchOptions {
  limit?: number
  language?: string
  /** Optional bias point — results near it rank first. Both are required together. */
  lat?: number | null
  lon?: number | null
  signal?: AbortSignal
}

export async function searchPlaces(
  query: string,
  { limit, language, lat, lon, signal }: PlaceSearchOptions = {},
): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q: query })
  if (limit !== undefined) params.set('limit', String(limit))
  if (language) params.set('language', language)
  if (lat !== null && lat !== undefined && lon !== null && lon !== undefined) {
    params.set('lat', String(lat))
    params.set('lon', String(lon))
  }
  const { items } = await request<PlaceSearchResponse>(`/api/places/search?${params}`, { signal })
  return items
}
