import { Router } from 'express'
import pool from '../db/index.js'
import { parseId } from '../validators/contactValidators.js'
import {
  listContacts,
  searchContacts,
  getContact,
  createContact,
  patchContact,
  deleteContact,
  createNote,
  deleteNote,
  listVenues,
  linkVenue,
  unlinkVenue,
  importContacts,
} from '../services/contactService.js'

const router = Router()

function requireParam(req, res, name, label = name) {
  const id = parseId(req.params[name])
  if (id === null) {
    res.status(400).json({ error: `Invalid ${label}` })
    return null
  }
  return id
}

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

router.get('/', async (req, res) => {
  const result = await listContacts(pool, req.tenantId, req.query)
  if (result.error) return sendError(res, result.error)
  res.json(result.contacts)
})

router.get('/search', async (req, res) => {
  res.json(await searchContacts(pool, req.tenantId, req.query))
})

router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getContact(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.contact)
})

router.post('/', async (req, res) => {
  const result = await createContact(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.contact)
})

router.patch('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchContact(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.contact)
})

router.delete('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteContact(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- notes ----------

router.post('/:id/notes', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await createNote(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.note)
})

router.delete('/:id/notes/:noteId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const noteId = requireParam(req, res, 'noteId'); if (noteId === null) return
  const result = await deleteNote(pool, req.tenantId, id, noteId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- venue links ----------
// Reverse side of the venue_contacts link: manage a contact's venues/festivals
// from the contact. The link row is shared with the venue side (venues.js); both
// festivals (category='festival') and venues live in the same venues table.

router.get('/:id/venues', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await listVenues(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.venues)
})

router.post('/:id/venues', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await linkVenue(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.venue)
})

router.delete('/:id/venues/:venueId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const venueId = requireParam(req, res, 'venueId'); if (venueId === null) return
  const result = await unlinkVenue(pool, req.tenantId, id, venueId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- import ----------

router.post('/import', async (req, res) => {
  const result = await importContacts(req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.summary)
})

export default router
