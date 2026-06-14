import type { ApiError, RequestOptions } from '../types/api.ts'

let csrfToken: string | null = null

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

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
    const data = await res.json().catch(() => ({}))
    throw Object.assign(new Error(data.error || 'Unauthorized'), { ...data, status: 401, body: data }) as ApiError
  }
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { ...data, status: res.status, body: data }) as ApiError
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
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `HTTP ${res.status}`)
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
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data as T
}
