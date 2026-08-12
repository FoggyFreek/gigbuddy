// Mounted at /api/band-profiles on the user-level tier: authenticated + terms
// accepted, no active tenant and no membership required. A band that is not a
// gigbuddy customer belongs to nobody, so there is no tenant to resolve.
//
// There is deliberately NO create route here. A profile is only ever created as
// part of adding it to a My Bands collection (POST /api/my-bands), in one
// transaction, so an unheld global row cannot come into existence.
import { Router } from 'express'
import pool from '../db/index.js'
import { auditLog } from '../utils/auditLog.js'
import { requireParam, sendError } from './routeHelpers.js'
import { searchProfiles, getProfile, patchProfile } from '../services/bandProfileService.js'

const router = Router()

router.get('/search', async (req, res) => {
  const result = await searchProfiles(pool, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getProfile(pool, req.user, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.profile)
})

router.patch('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchProfile(pool, req.user, id, req.body)
  if (result.audit) auditLog(req, result.audit.action, result.audit.details)
  if (result.error) return sendError(res, result.error)
  res.json(result.profile)
})

export default router
