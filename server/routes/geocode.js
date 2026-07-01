import { Router } from 'express'
import { geocodePlace } from '../services/geocodeService.js'

const router = Router()
const MAX_PARAM_LENGTH = 120

function textParam(value) {
  return String(value ?? '').trim()
}

function validatePlace(query) {
  const place = {
    city: textParam(query.city),
    region: textParam(query.region),
    country: textParam(query.country),
    address: textParam(query.address),
    postalCode: textParam(query.postalCode),
  }

  if (!place.city) return { error: 'city is required' }
  if (Object.values(place).some((value) => value.length > MAX_PARAM_LENGTH)) {
    return { error: 'geocode parameters are too long' }
  }
  return { place }
}

router.get('/', async (req, res) => {
  const validation = validatePlace(req.query)
  if (validation.error) return res.status(400).json({ error: validation.error })

  const result = await geocodePlace(validation.place)
  res.json(result)
})

export default router
