// The cross-tenant artist agenda, mounted at /api/me on its own access tier:
// authenticated + terms accepted + resolveMemberTenantIds, and deliberately
// NO resolveTenantId — these reads span tenants rather than sitting inside one.
//
// Every rule about which tenants a caller may see lives in memberTenants;
// handlers only pass the server-derived scope to the owning application service.
import { Router } from 'express'
import pool from '../../db/index.js'
import { requireParam, sendError } from '../../platform/http/routeHelpers.js'
import {
  listMyAgenda,
} from './meService.js'
import {
  getMyGig,
  listMyGigMapData,
  listMyPastGigs,
  listMyUpcomingGigs,
  searchMyGigs,
} from './meGigService.js'
import {
  getMyNextRehearsal,
  getMyRehearsal,
  listMyPastRehearsals,
  listMyUpcomingRehearsals,
  setMyRehearsalVote,
} from './meRehearsalService.js'
import {
  getMyBandEvent,
  listMyPastBandEvents,
  listMyUpcomingBandEvents,
} from './meBandEventService.js'
import {
  listMyTasks,
  setMyTaskDone,
} from './meTaskService.js'

const router = Router()

// Everything I'm booked for in a day window, across every band.
router.get('/agenda', async (req, res) => {
  const result = await listMyAgenda(pool, req.user.id, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

// The artist dashboard's feeds: the same tiles a band sees, sourced from every
// band the caller plays in instead of one active tenant.
router.get('/gigs/upcoming', async (req, res) => {
  const result = await listMyUpcomingGigs(pool, req.user.id, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/gigs/past', async (req, res) => {
  const result = await listMyPastGigs(pool, req.user.id, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/gigs/search', async (req, res) => {
  res.json(await searchMyGigs(pool, req.user.id, req.memberTenants, req.query))
})

router.get('/gigs/map', async (req, res) => {
  const result = await listMyGigMapData(pool, req.user.id, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/gigs/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getMyGig(pool, req.user.id, req.memberTenants, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.gig)
})

router.get('/rehearsals/next', async (req, res) => {
  const result = await getMyNextRehearsal(pool, req.user.id, req.memberTenants)
  res.json(result.rehearsal)
})

router.get('/rehearsals/upcoming', async (req, res) => {
  const result = await listMyUpcomingRehearsals(pool, req.user.id, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/rehearsals/past', async (req, res) => {
  const result = await listMyPastRehearsals(pool, req.user.id, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/rehearsals/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getMyRehearsal(pool, req.user.id, req.memberTenants, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.rehearsal)
})

router.patch('/rehearsals/:id/vote', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await setMyRehearsalVote(pool, req.user.id, req.memberTenants, id, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.json(result.rehearsal)
})

router.get('/band-events/upcoming', async (req, res) => {
  const result = await listMyUpcomingBandEvents(pool, req.user.id, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/band-events/past', async (req, res) => {
  const result = await listMyPastBandEvents(pool, req.user.id, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.get('/band-events/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getMyBandEvent(pool, req.user.id, req.memberTenants, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.event)
})

// Always the caller's own tasks — no assignee filter, see meService.
router.get('/tasks', async (req, res) => {
  const result = await listMyTasks(pool, req.user.id, req.memberTenants, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result)
})

router.patch('/tasks/:id/done', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await setMyTaskDone(pool, req.user.id, req.memberTenants, id, req.body || {})
  if (result.error) return sendError(res, result.error)
  res.json(result.task)
})

export default router
