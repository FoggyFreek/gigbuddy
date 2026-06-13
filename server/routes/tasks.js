import { Router } from 'express'
import pool from '../db/index.js'
import { listTasks } from '../services/taskService.js'

const router = Router()

router.get('/', async (req, res) => {
  res.json(await listTasks(pool, req.tenantId))
})

export default router
