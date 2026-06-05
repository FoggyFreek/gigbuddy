// File-upload helpers for song documents (PDF) and recordings (mp3).
// Each mirrors createGigAttachment: verify the parent belongs to the tenant, verify
// the file's magic bytes match its declared type, upload to object storage, then
// insert the DB row — rolling the object back if the insert fails so nothing is
// orphaned.
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  uploadObject,
  removeObject,
  songDocumentKey,
  songRecordingKey,
} from './storageService.js'
import { verifyDocumentContent, verifyAudioContent } from '../utils/verifyFileContent.js'

async function songExistsInTenant(db, tenantId, songId) {
  const { rows } = await db.query(
    'SELECT 1 FROM songs WHERE id = $1 AND tenant_id = $2',
    [songId, tenantId],
  )
  return rows.length > 0
}

export async function createSongDocument({ db, tenantId, songId, file }) {
  if (!(await songExistsInTenant(db, tenantId, songId))) {
    return { error: { status: 404, body: { error: 'Not found' } } }
  }
  if (!verifyDocumentContent(file.buffer, file.mimetype)) {
    return { error: { status: 400, body: { error: 'File content does not match declared type' } } }
  }

  const ext = path.extname(file.originalname).toLowerCase()
  const objectKey = songDocumentKey(tenantId, randomUUID(), ext)

  await uploadObject(objectKey, file.buffer, file.size, file.mimetype)

  try {
    const { rows } = await db.query(
      `INSERT INTO song_documents (song_id, tenant_id, object_key, original_filename, content_type, file_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, object_key, original_filename, content_type, file_size, uploaded_at`,
      [songId, tenantId, objectKey, file.originalname, file.mimetype, file.size],
    )
    return { document: rows[0] }
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }
}

export async function createSongRecording({ db, tenantId, songId, file }) {
  if (!(await songExistsInTenant(db, tenantId, songId))) {
    return { error: { status: 404, body: { error: 'Not found' } } }
  }
  if (!verifyAudioContent(file.buffer)) {
    return { error: { status: 400, body: { error: 'File content does not look like an mp3' } } }
  }

  const ext = path.extname(file.originalname).toLowerCase()
  const objectKey = songRecordingKey(tenantId, randomUUID(), ext)

  await uploadObject(objectKey, file.buffer, file.size, file.mimetype)

  try {
    const { rows } = await db.query(
      `INSERT INTO song_recordings (song_id, tenant_id, object_key, original_filename, content_type, file_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, object_key, original_filename, content_type, file_size, uploaded_at`,
      [songId, tenantId, objectKey, file.originalname, file.mimetype, file.size],
    )
    return { recording: rows[0] }
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }
}
