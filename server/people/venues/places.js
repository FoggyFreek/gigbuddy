import { Router } from 'express'
import { getPlaceDetails, searchPlaces } from './placeService.js'
import { sendError } from '../../platform/http/routeHelpers.js'

const router = Router()

// Generic place lookup, not tied to any resource. Consumed by the shared
// PlaceSearchField control and by the venue enrich dialog.
router.get('/search', async (req, res) => {
  const result = await searchPlaces(req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/details/:id', async (req, res) => {
  const result = await getPlaceDetails({ id: req.params.id, sessionId: req.query.sessionId })
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

export default router
