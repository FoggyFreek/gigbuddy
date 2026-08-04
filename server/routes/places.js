import { Router } from 'express'
import { searchPlaces } from '../services/placeService.js'
import { sendError } from './routeHelpers.js'

const router = Router()

// Generic place lookup, not tied to any resource. Consumed by the shared
// PlaceSearchField control and by the venue enrich dialog.
router.get('/search', async (req, res) => {
  const result = await searchPlaces(req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

export default router
