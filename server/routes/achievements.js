import { Router } from 'express'
import pool from '../db/index.js'
import { listAchievements } from '../services/achievementService.js'

const router = Router()

// Full achievement list for the active tenant: { key, category, cheers,
// unlocked_at | null }. Evaluation (and unlock persistence) happens lazily
// inside the service on every read.
router.get('/', async (req, res) => {
  res.json(await listAchievements(pool, req.tenantId))
})

export default router
