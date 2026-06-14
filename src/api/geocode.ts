import { request } from './_client.ts'

interface GeocodePlace {
  city: string
  region?: string
  country?: string
}

interface GeocodeResult {
  status: 'hit' | 'empty'
  coords?: { lat: number; lon: number }
}

export function lookupGeocode({ city, region, country }: GeocodePlace) {
  const params = new URLSearchParams()
  params.set('city', city)
  if (region) params.set('region', region)
  if (country) params.set('country', country)
  return request<GeocodeResult>(`/api/geocode?${params}`)
}
