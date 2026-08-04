import { request } from './_client.ts'
import type { LimitedCollectionResponse, PlaceSuggestion } from '../types/api.ts'
import { recoverPostalCode } from '../utils/postalCode.ts'

export interface PlaceSearchOptions {
  limit?: number
  language?: string
  /** Optional bias point — results near it rank first. Both are required together. */
  lat?: number | null
  lon?: number | null
  signal?: AbortSignal
  /** Stable UUID for one as-you-type and selection journey. */
  sessionId?: string
}

export async function searchPlaces(
  query: string,
  { limit, language, lat, lon, signal, sessionId }: PlaceSearchOptions = {},
): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q: query })
  if (limit !== undefined) params.set('limit', String(limit))
  if (language) params.set('language', language)
  if (sessionId) params.set('sessionId', sessionId)
  if (lat !== null && lat !== undefined && lon !== null && lon !== undefined) {
    params.set('lat', String(lat))
    params.set('lon', String(lon))
  }
  const { items } = await request<LimitedCollectionResponse<PlaceSuggestion>>(
    `/api/places/search?${params}`, { signal },
  )
  return items
}

export async function getPlaceDetails(suggestion: PlaceSuggestion): Promise<PlaceSuggestion> {
  if (!suggestion.details) return suggestion
  const params = new URLSearchParams()
  if (suggestion.details.session_id) params.set('sessionId', suggestion.details.session_id)
  const query = params.size ? `?${params}` : ''
  const details = await request<PlaceSuggestion>(
    `/api/places/details/${encodeURIComponent(suggestion.details.id)}${query}`,
  )
  return {
    ...details,
    postal_code: recoverPostalCode(
      details.country,
      details.postal_code,
      [suggestion.freeform_address, details.freeform_address],
    ),
  }
}
