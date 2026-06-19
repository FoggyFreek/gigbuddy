import { Router } from 'express'
import pool from '../db/index.js'
import { requirePermission } from '../middleware/permissions.js'
import { PERMISSIONS } from '../auth/permissions.js'
import {
  parseId,
  parseOrderedSetIds,
  parseReorderItemsPayload,
} from '../validators/setlistValidators.js'
import {
  listSetlists,
  searchSetlists,
  getSetlist,
  createSetlist,
  patchSetlist,
  deleteSetlist,
  reorderSets,
  createSet,
  patchSet,
  deleteSet,
  createItem,
  patchItem,
  reorderItems,
  deleteItem,
  setItemNote,
} from '../services/setlistService.js'

const router = Router()

function requireParam(req, res, name) {
  const id = parseId(req.params[name])
  if (id === null) {
    res.status(400).json({ error: `Invalid ${name}` })
    return null
  }
  return id
}

function sendError(res, error) {
  res.status(error.status).json(error.body)
}

// ---------- setlists ----------

router.get('/', async (req, res) => {
  res.json(await listSetlists(pool, req.tenantId))
})

// Global search (min 3 chars): setlist name. Must precede /:id.
router.get('/search', async (req, res) => {
  res.json(await searchSetlists(pool, req.tenantId, req.query))
})

router.post('/', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const result = await createSetlist(req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.setlist)
})

router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getSetlist(pool, req.tenantId, id, req.user.id)
  if (result.error) return sendError(res, result.error)
  res.json(result.tree)
})

router.patch('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchSetlist(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.setlist)
})

router.delete('/:id', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteSetlist(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- sets ----------

// Reorder sets — registered before '/:id/sets/:setId' so 'reorder' isn't matched as an id.
router.patch('/:id/sets/reorder', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const parsed = parseOrderedSetIds(req.body)
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  const result = await reorderSets(req.tenantId, id, parsed.orderedSetIds)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

router.post('/:id/sets', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await createSet(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.set)
})

router.patch('/:id/sets/:setId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const setId = requireParam(req, res, 'setId'); if (setId === null) return
  const result = await patchSet(pool, req.tenantId, id, setId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.set)
})

router.delete('/:id/sets/:setId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const setId = requireParam(req, res, 'setId'); if (setId === null) return
  const result = await deleteSet(pool, req.tenantId, id, setId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- items ----------

// Reorder/move items — registered before '/:id/items/:itemId'.
router.patch('/:id/items/reorder', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const parsed = parseReorderItemsPayload(req.body)
  if (parsed.error) return res.status(400).json({ error: parsed.error })
  const result = await reorderItems(req.tenantId, id, parsed.payloadSets)
  if (result.error) return sendError(res, result.error)
  res.json({ clearedIds: result.clearedIds })
})

router.post('/:id/sets/:setId/items', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const setId = requireParam(req, res, 'setId'); if (setId === null) return
  const result = await createItem(pool, req.tenantId, id, setId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.item)
})

router.patch('/:id/items/:itemId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const itemId = requireParam(req, res, 'itemId'); if (itemId === null) return
  const result = await patchItem(pool, req.tenantId, id, itemId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.item)
})

// Upsert/clear the requesting user's personal note on a song item.
router.put('/:id/items/:itemId/note', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const itemId = requireParam(req, res, 'itemId'); if (itemId === null) return
  const result = await setItemNote(pool, req.tenantId, id, req.user.id, itemId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json({ my_note: result.my_note })
})

router.delete('/:id/items/:itemId', requirePermission(PERMISSIONS.PLANNING_WRITE), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const itemId = requireParam(req, res, 'itemId'); if (itemId === null) return
  const result = await deleteItem(req.tenantId, id, itemId)
  if (result.error) return sendError(res, result.error)
  res.json({ clearedIds: result.clearedIds })
})

export default router
