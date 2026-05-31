import { request } from './_client.js'

export function lookupGeocode({ city, region, country }) {
  const params = new URLSearchParams()
  params.set('city', city)
  if (region) params.set('region', region)
  if (country) params.set('country', country)
  return request(`/api/geocode?${params}`)
}
