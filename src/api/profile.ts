import { request, requestForm } from './_client.ts'
import type { Tenant, Id } from '../types/entities.ts'

interface ProfileLink {
  id?: Id
  label?: string
  url?: string
  sort_order?: number
}

interface Profile extends Tenant {
  links?: ProfileLink[]
}

export interface IntegrationSecretStatus {
  isSet: boolean
  changedAt: string | null
}

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/profile${path}`, options)

export const getProfile = () => api<Profile>('/')
export const updateProfile = (body: Partial<Profile>) =>
  api<Profile>('/', { method: 'PATCH', body: JSON.stringify(body) })

// Band banner path, cached for the session. The banner only changes via
// uploadBanner() (there is no removal path), so display-only callers that open
// the gig detail repeatedly can skip refetching the whole profile JUST to read
// one field. The cache is refreshed by uploadBanner and dropped by
// clearBannerPathCache() on tenant switch / logout (the profile is
// tenant-scoped). A full page reload re-fetches too, covering edits made from
// another session.
let bannerPathCache: { value: string | null } | null = null

export async function getBannerPath(): Promise<string | null> {
  if (bannerPathCache) return bannerPathCache.value
  const profile = await getProfile()
  bannerPathCache = { value: profile.banner_path ?? null }
  return bannerPathCache.value
}

export function clearBannerPathCache(): void {
  bannerPathCache = null
}

export const createLink = (body: Partial<ProfileLink>) =>
  api<ProfileLink>('/links', { method: 'POST', body: JSON.stringify(body) })
export const updateLink = (linkId: Id, body: Partial<ProfileLink>) =>
  api<ProfileLink>(`/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteLink = (linkId: Id) => api<void>(`/links/${linkId}`, { method: 'DELETE' })

export function uploadLogo(file: File) {
  const fd = new FormData()
  fd.append('logo', file)
  return requestForm<{ logo_path: string | null }>('/api/profile/logo', fd)
}

export async function uploadBanner(file: File) {
  const fd = new FormData()
  fd.append('banner', file)
  const result = await requestForm<{ banner_path: string | null }>('/api/profile/banner', fd)
  bannerPathCache = { value: result.banner_path ?? null }
  return result
}

export function uploadAvatar(file: File) {
  const fd = new FormData()
  fd.append('avatar', file)
  return requestForm<{ avatar_path: string | null }>('/api/profile/avatar', fd)
}

export function uploadLogoDark(file: File) {
  const fd = new FormData()
  fd.append('logo_dark', file)
  return requestForm<{ logo_dark_path: string | null }>('/api/profile/logo-dark', fd)
}

export const getBandsintownKey = () => api<IntegrationSecretStatus>('/bandsintown-key')
export const setBandsintownKey = (key: string) =>
  api<IntegrationSecretStatus>('/bandsintown-key', { method: 'PUT', body: JSON.stringify({ key }) })
export const clearBandsintownKey = () => api<IntegrationSecretStatus>('/bandsintown-key', { method: 'DELETE' })

export const getMollieKey = () => api<IntegrationSecretStatus>('/mollie-key')
export const setMollieKey = (key: string) =>
  api<IntegrationSecretStatus>('/mollie-key', { method: 'PUT', body: JSON.stringify({ key }) })
export const clearMollieKey = () => api<IntegrationSecretStatus>('/mollie-key', { method: 'DELETE' })

interface ShopifyClientId {
  clientId?: string | null
}

export const getShopifyClientId = () => api<ShopifyClientId>('/shopify-client-id')
export const setShopifyClientId = (clientId: string) =>
  api<ShopifyClientId>('/shopify-client-id', { method: 'PUT', body: JSON.stringify({ clientId }) })
export const clearShopifyClientId = () => api<ShopifyClientId>('/shopify-client-id', { method: 'DELETE' })

export const getShopifySecret = () => api<IntegrationSecretStatus>('/shopify-secret')
export const setShopifySecret = (secret: string) =>
  api<IntegrationSecretStatus>('/shopify-secret', { method: 'PUT', body: JSON.stringify({ secret }) })
export const clearShopifySecret = () => api<IntegrationSecretStatus>('/shopify-secret', { method: 'DELETE' })

interface ShopifyDomain {
  domain?: string | null
}

export const getShopifyDomain = () => api<ShopifyDomain>('/shopify-domain')
export const setShopifyDomain = (domain: string) =>
  api<ShopifyDomain>('/shopify-domain', { method: 'PUT', body: JSON.stringify({ domain }) })
export const clearShopifyDomain = () => api<ShopifyDomain>('/shopify-domain', { method: 'DELETE' })
