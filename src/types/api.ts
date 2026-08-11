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
  /**
   * Machine-readable failure code from the error body (e.g.
   * 'supplier_invoice_number_taken'). Every field of the body is mirrored onto
   * the Error by _client.ts, so this is always readable when the server sent one.
   */
  code?: string
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

/** Keyset pagination cursor, keyed on (date, id) — see `GET /gigs/past`. */
export interface ListCollectionCursor {
  date: string
  id: import('./entities.ts').Id
}

/** Bounded collection paginated via a keyset cursor instead of offset/page params. */
export interface LimitedCollectionWithCursorResponse<T> {
  items: T[]
  meta: {
    limit: number
    returned: number
    nextCursor: ListCollectionCursor | null
  }
}

/**
 * Which band a row came from. Only cross-tenant reads (`/api/me/*`) carry this —
 * a tenant-scoped endpoint's rows are all from the active tenant, so they don't.
 */
export interface CrossTenantRef {
  tenantId: import('./entities.ts').Id
  tenantName: string | null
  tenantAvatarPath: string | null
  kind: import('../auth/tenantKinds.ts').TenantKind | null
}

/** An entity that carries its band label when it came from a cross-tenant read. */
export type MaybeCrossTenant<T> = T & Partial<CrossTenantRef>

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

export interface StorageConnection {
  configured: boolean
  provider: 'rustfs' | 'backblaze' | 's3'
  endpoint: string
  bucket: string
  connected: boolean
  operationsVerified: boolean
  errorCode: string | null
}

/**
 * A place-lookup result, normalized server-side onto the app's own field names so
 * consumers never see the upstream provider's shape. The text fields line up with
 * `PLACE_FILLABLE_FIELDS` in `shared/placeFields.js`, so a suggestion can be
 * merged straight into a form. `freeform_address` and `categories` are display
 * only and are never persisted.
 */
export interface PlaceSuggestion {
  id: string | null
  name: string | null
  street_and_number: string | null
  postal_code: string | null
  city: string | null
  region: string | null
  country: string | null
  website: string | null
  phone: string | null
  latitude: number | null
  longitude: number | null
  freeform_address: string | null
  categories: string[]
  /** Present on lightweight v3 suggestions until the Details follow-up resolves them. */
  details?: {
    id: string
    session_id: string | null
  } | null
}

/** Result of applying a place suggestion to a record: what actually got filled. */
export interface PlaceEnrichResponse<T> {
  venue: T
  filled: string[]
}
