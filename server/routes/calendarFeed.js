import { Router } from 'express'
import pool from '../db/index.js'
import { requireEntitlement } from '../middleware/entitlements.js'
import { FEATURES } from '../auth/entitlements.js'
import {
  getOrDescribeFeed,
  regenerateFeed,
  revokeFeed,
} from '../services/calendarFeedService.js'

const router = Router()

// Describe the caller's feed for the active tenant (null when none exists yet).
// Not entitlement-gated: an admin must be able to see the token exists in
// order to revoke it after a downgrade.
router.get('/', async (req, res) => {
  res.json(await getOrDescribeFeed(pool, req.user.id, req.tenantId))
})

// Create or rotate the feed token; rotating invalidates the previous URL.
// Minting new bearer tokens requires the integrations feature.
router.post('/regenerate', requireEntitlement(FEATURES.INTEGRATIONS), async (req, res) => {
  res.json(await regenerateFeed(pool, req.user.id, req.tenantId))
})

// Disable the feed entirely.
router.delete('/', async (req, res) => {
  await revokeFeed(pool, req.user.id, req.tenantId)
  res.status(204).end()
})

export default router
