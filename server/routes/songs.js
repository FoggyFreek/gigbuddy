import { Router } from 'express'
import multer from 'multer'
import pool from '../db/index.js'
import { parseId } from '../validators/songValidators.js'
import {
  listSongs,
  searchSongs,
  searchTags,
  getSong,
  createSong,
  patchSong,
  deleteSong,
  setSongTags,
  createSongLink,
  patchSongLink,
  deleteSongLink,
  createSongDocument,
  deleteSongDocument,
  createSongRecording,
  deleteSongRecording,
  importSongs,
} from '../services/songService.js'

const router = Router()

const DOCUMENT_ALLOWED_TYPES = new Set(['application/pdf'])
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

const RECORDING_ALLOWED_TYPES = new Set(['audio/mpeg'])
const recordingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

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

// ---------- songs ----------

router.get('/', async (req, res) => {
  res.json(await listSongs(pool, req.tenantId))
})

// Must be registered before GET /:id, or '/tags' is captured by ':id'.
router.get('/tags', async (req, res) => {
  res.json(await searchTags(pool, req.tenantId, req.query.q))
})

// Must also be registered before GET /:id.
router.get('/search', async (req, res) => {
  res.json(await searchSongs(pool, req.tenantId, req.query.q))
})

router.get('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await getSong(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.json(result.song)
})

router.post('/', async (req, res) => {
  const result = await createSong(pool, req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.song)
})

router.patch('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await patchSong(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.song)
})

router.delete('/:id', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await deleteSong(pool, req.tenantId, id)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- tags ----------

router.put('/:id/tags', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await setSongTags(req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.tags)
})

// ---------- links ----------

router.post('/:id/links', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const result = await createSongLink(pool, req.tenantId, id, req.body)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.link)
})

router.patch('/:id/links/:linkId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const linkId = requireParam(req, res, 'linkId'); if (linkId === null) return
  const result = await patchSongLink(pool, req.tenantId, id, linkId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.link)
})

router.delete('/:id/links/:linkId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const linkId = requireParam(req, res, 'linkId'); if (linkId === null) return
  const result = await deleteSongLink(pool, req.tenantId, id, linkId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- documents (pdf) ----------

router.post('/:id/documents', documentUpload.single('file'), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!DOCUMENT_ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }
  const result = await createSongDocument(pool, req.tenantId, id, req.file)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.document)
})

router.delete('/:id/documents/:docId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const docId = requireParam(req, res, 'docId'); if (docId === null) return
  const result = await deleteSongDocument(pool, req.tenantId, id, docId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- recordings (mp3) ----------

router.post('/:id/recordings', recordingUpload.single('file'), async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (!RECORDING_ALLOWED_TYPES.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'File type not allowed' })
  }
  const result = await createSongRecording(pool, req.tenantId, id, req.file)
  if (result.error) return sendError(res, result.error)
  res.status(201).json(result.recording)
})

router.delete('/:id/recordings/:recId', async (req, res) => {
  const id = requireParam(req, res, 'id'); if (id === null) return
  const recId = requireParam(req, res, 'recId'); if (recId === null) return
  const result = await deleteSongRecording(pool, req.tenantId, id, recId)
  if (result.error) return sendError(res, result.error)
  res.status(204).end()
})

// ---------- import ----------

router.post('/import', async (req, res) => {
  const result = await importSongs(req.tenantId, req.body)
  if (result.error) return sendError(res, result.error)
  res.json(result.summary)
})

export default router
