import { Router } from 'express'
import { searchPlaces } from '../services/placeSearchService.js'
import { parsePlaceQuery } from '../validators/placeSearchValidators.js'
import { sendError } from './routeHelpers.js'

const router = Router()

// Generic place lookup, not tied to any resource. Consumed by the shared
// PlaceSearchField control and by the venue enrich dialog.
router.get('/search', async (req, res) => {
  const parsed = parsePlaceQuery(req.query)
  if (parsed.error) return res.status(400).json({ error: parsed.error })

  const result = await searchPlaces(parsed.params)
  if (result.error) return sendError(res, result.error)
  res.json({ items: result.items })
})

export default router
