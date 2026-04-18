import { Router } from 'express'
import gigsRouter from './gigs.js'
import tasksRouter from './tasks.js'
import profileRouter from './profile.js'
import bandMembersRouter from './bandMembers.js'
import availabilityRouter from './availability.js'
import rehearsalsRouter from './rehearsals.js'
import authRouter from './auth.js'
import usersRouter from './users.js'
import { requireApproved, requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

router.use('/auth', authRouter)
router.use('/users', requireAdmin, usersRouter)
router.use('/gigs', requireApproved, gigsRouter)
router.use('/tasks', requireApproved, tasksRouter)
router.use('/profile', requireApproved, profileRouter)
router.use('/band-members', requireApproved, bandMembersRouter)
router.use('/availability', requireApproved, availabilityRouter)
router.use('/rehearsals', requireApproved, rehearsalsRouter)

export default router
