import type { ApiError, RequestOptions } from '../types/api.ts'
import { TERMS_EXEMPT_PATHS } from '../constants/termsExemptPaths.ts'

let csrfToken: string | null = null

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

interface ErrorResponse {
  error?: string
  code?: string
  [key: string]: unknown
}

function handleTermsRequired(data: ErrorResponse): void {
  // Skip the same surfaces the router's terms gate exempts (onboarding,
  // invite redemption, /accept-terms itself) — those own the acceptance UX,
  // so a gated call firing there must never hard-redirect them away mid-flow.
  if (data.code === 'terms_acceptance_required' && !TERMS_EXEMPT_PATHS.has(window.location.pathname)) {
    // A soft route change can keep an old TERMS_VERSION in the loaded bundle.
    // A document navigation reloads the deployed assets before acceptance.
    window.location.assign('/accept-terms')
  }
}

async function errorResponse(res: Response): Promise<ErrorResponse> {
  const data = await res.json().catch(() => ({})) as ErrorResponse
  handleTermsRequired(data)
  return data
}

function apiError(data: ErrorResponse, status: number, fallback: string): ApiError {
  return Object.assign(new Error(data.error || fallback), { ...data, status, body: data }) as ApiError
}

// Generic over the expected JSON response. Callers pass T (e.g. request<Account[]>)
// so the typed api wrappers in this dir flow real shapes out to components. On a
// non-2xx the thrown value is an ApiError (Error + status + body); see types/api.ts.
export async function request<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) }
  if (!SAFE_METHODS.has(method) && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken
  }

  const res = await fetch(url, { ...options, headers })

  const responseToken = res.headers.get('X-CSRF-Token')
  if (responseToken) csrfToken = responseToken

  if (res.status === 204) return null as T
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
    const data = await errorResponse(res)
    throw apiError(data, 401, 'Unauthorized')
  }
  const data = await res.json() as ErrorResponse
  if (!res.ok) {
    handleTermsRequired(data)
    throw apiError(data, res.status, 'Request failed')
  }
  return data as T
}

export async function requestBlob(url: string, options: RequestOptions = {}): Promise<Blob> {
  const method = (options.method || 'POST').toUpperCase()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) }
  if (!SAFE_METHODS.has(method) && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken
  }
  const res = await fetch(url, { ...options, headers })
  const responseToken = res.headers.get('X-CSRF-Token')
  if (responseToken) csrfToken = responseToken
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
    throw Object.assign(new Error('Unauthorized'), { status: 401 }) as ApiError
  }
  if (!res.ok) {
    const data = await errorResponse(res)
    throw apiError(data, res.status, `HTTP ${res.status}`)
  }
  return res.blob()
}

export async function requestForm<T = unknown>(url: string, formData: FormData): Promise<T> {
  const headers: Record<string, string> = {}
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken
  const res = await fetch(url, { method: 'POST', credentials: 'include', headers, body: formData })
  const responseToken = res.headers.get('X-CSRF-Token')
  if (responseToken) csrfToken = responseToken
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
    throw Object.assign(new Error('Unauthorized'), { status: 401 }) as ApiError
  }
  if (res.status === 204) return null as T
  const data = await res.json() as ErrorResponse
  if (!res.ok) {
    handleTermsRequired(data)
    throw apiError(data, res.status, 'Request failed')
  }
  return data as T
}
