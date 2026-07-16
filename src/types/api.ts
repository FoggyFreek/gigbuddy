// Shared types for the API layer (src/api/*). The error shape here matches what
// _client.ts throws: a plain Error augmented with the parsed JSON body plus a
// numeric `status`, so callers can branch on `err.status` / `err.body`.

/** The augmented Error thrown by request()/requestBlob()/requestForm() on non-2xx. */
export interface ApiError extends Error {
  status: number
  /** The parsed JSON error body, when the server returned one. */
  body?: unknown
  /** Server-provided message, mirrored onto the Error via Object.assign. */
  error?: string
}

/** Narrowing helper for catch blocks: `if (isApiError(e) && e.status === 409)`. */
export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && typeof (e as ApiError).status === 'number'
}

/** Options accepted by request() — fetch options with our JSON-string body. */
export type RequestOptions = RequestInit

/** Stable envelope for bounded list endpoints such as `GET /gigs/upcoming`. */
export interface LimitedCollectionResponse<T> {
  items: T[]
  meta: {
    limit: number
    returned: number
  }
}

/** Bounded collection whose full matching count is returned with the page. */
export interface LimitedCollectionWithTotalResponse<T> {
  items: T[]
  meta: {
    limit: number
    returned: number
    total: number
  }
}

/** Stable envelope for windowed list endpoints such as `GET /gigs/range` (inclusive day window). */
export interface WindowedCollectionResponse<T> {
  items: T[]
  meta: {
    from: string
    to: string
    returned: number
  }
}

export interface GigMapPlace {
  id: import('./entities.ts').Id
  city: string | null
  region: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
}

export interface GigMapGig {
  id: import('./entities.ts').Id
  event_date: string
  event_description: string
  venue: GigMapPlace | null
  festival: GigMapPlace | null
}
