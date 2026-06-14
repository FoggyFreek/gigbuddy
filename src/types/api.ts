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
