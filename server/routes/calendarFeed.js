import { Router } from 'express'
import pool from '../db/index.js'
import {
  getOrDescribeFeed,
  regenerateFeed,
  revokeFeed,
} from '../services/calendarFeedService.js'

const router = Router()

// Describe the caller's feed for the active tenant (null when none exists yet).
router.get('/', async (req, res) => {
  res.json(await getOrDescribeFeed(pool, req.user.id, req.tenantId))
})

// Create or rotate the feed token; rotating invalidates the previous URL.
router.post('/regenerate', async (req, res) => {
  res.json(await regenerateFeed(pool, req.user.id, req.tenantId))
})

// Disable the feed entirely.
router.delete('/', async (req, res) => {
  await revokeFeed(pool, req.user.id, req.tenantId)
  res.status(204).end()
})

export default router
