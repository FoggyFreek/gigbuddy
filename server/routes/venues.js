import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import { parseId } from '../validators/venueValidators.js'
import { requireParam, sendError } from './routeHelpers.js'
import {
  listVenues,
  searchVenues,
  checkVenueDuplicates,
  getVenue,
  getCategoryImpact,
  createVenue,
  patchVenue,
  deleteVenue,
  listVenueContacts,
  linkVenueContact,
  updateVenueContactPrimary,
  unlinkVenueContact,
  importVenues,
} from '../services/venueService.js'

const router = Router()

// List all venues with primary contact and gig years
router.get('/', async (req, res) => {
  res.json(await listVenues(pool, req.tenantId))
})

// Typeahead search (min 3 chars)
router.get('/search', async (req, res) => {
  res.json(await searchVenues(pool, req.tenantId, req.query))
})

router.post('/duplicate-check', async (req, res) => {
  res.json(await checkVenueDuplicates(pool, req.tenantId, req.body))
})

// Get single venue
router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getVenue(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.venue)
})

// Gigs affected by a prospective category change
router.get('/:id/category-impact', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getCategoryImpact(pool, req.tenantId, id, req.query.new_category)
  if (result.error) return sendError(res, result.error)
  res.json({ affected_gigs: result.affectedGigs })
})

// Create venue
router.post('/', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await createVenue(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.venue)
})

// Update venue (partial)
router.patch('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchVenue(req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.venue)
})

// Delete venue
router.delete('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteVenue(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Venue/contact links are informational; venue fields stay canonical for invoices.
router.get('/:id/contacts', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await listVenueContacts(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.contacts)
})

// Link contact to venue
router.post('/:id/contacts', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const contactId = parseId(req.body.contact_id)
  if (contactId === null) return res.status(400).json({ error: 'contact_id is required' })
  const result = await linkVenueContact(pool, req.tenantId, id, contactId)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.contact)
})

// Toggle primary contact
router.patch('/:id/contacts/:contactId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const contactId = requireParam(req, res, 'contactId'); if (contactId === null) return
  if (typeof req.body.is_primary !== 'boolean') {
    return res.status(400).json({ error: 'is_primary (boolean) is required' })
  }
  const result = await updateVenueContactPrimary(req.tenantId, id, contactId, req.body.is_primary)
  if (result.error) return sendError(res, result.error)
  res.json(result.contact)
})

// Unlink contact from venue
router.delete('/:id/contacts/:contactId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const contactId = requireParam(req, res, 'contactId'); if (contactId === null) return
  const result = await unlinkVenueContact(pool, req.tenantId, id, contactId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// Bulk import
router.post('/import', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await importVenues(req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.summary)
})

export default router
