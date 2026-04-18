import { Router } from 'express'
import pool from '../db/index.js'

const router = Router()

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT t.id, t.gig_id, t.title, t.done, t.due_date, t.created_at,
           g.event_description, g.event_date
    FROM gig_tasks t
    JOIN gigs g ON g.id = t.gig_id
    ORDER BY t.done ASC, t.due_date ASC NULLS LAST, t.created_at ASC
  `)
  res.json(rows)
})

export default router
