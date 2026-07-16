import { request } from './_client.ts'

interface GeocodePlace {
  city: string
  region?: string
  country?: string
  address?: string
  postalCode?: string
}

export interface GeocodeResult {
  status: 'hit' | 'empty' | 'fail'
  coords?: { lat: number; lon: number }
}

export function lookupGeocode({ city, region, country, address, postalCode }: GeocodePlace) {
  const params = new URLSearchParams()
  params.set('city', city)
  if (region) params.set('region', region)
  if (country) params.set('country', country)
  if (address) params.set('address', address)
  if (postalCode) params.set('postalCode', postalCode)
  return request<GeocodeResult>(`/api/geocode?${params}`)
}

export function lookupVenueGeocode(venueId: import('../types/entities.ts').Id) {
  return request<GeocodeResult>(`/api/geocode/venue/${venueId}`)
}
