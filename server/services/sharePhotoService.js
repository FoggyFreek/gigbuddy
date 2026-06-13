// Share-photo domain logic. Route handlers stay thin and delegate here.
// Functions that can fail with a specific HTTP outcome return
// { error: { status, body } }; success returns a domain payload.
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { uploadObject, removeObject, safeRemove, sharePhotoKey } from './storageService.js'
import { validateAndReencodeImage } from '../utils/imageProcess.js'
import {
  listSharePhotos,
  nextSortOrder,
  insertSharePhoto,
  getSharePhotoObjectKey,
  deleteSharePhoto,
} from '../repositories/sharePhotoRepository.js'

const NOT_FOUND = { error: { status: 404, body: { error: 'Not found' } } }

export async function listPhotos(db, tenantId) {
  return listSharePhotos(db, tenantId)
}

// Re-encodes and stores the uploaded image, then records it. Rolls the object
// back if the DB insert fails so nothing is orphaned.
export async function createPhoto(db, tenantId, file) {
  const image = await validateAndReencodeImage(file.buffer, file.mimetype)
  const ext = path.extname(file.originalname).toLowerCase() || '.jpg'
  const objectKey = sharePhotoKey(tenantId, randomUUID(), ext)
  const label = path.basename(file.originalname, ext) || 'Photo'
  const sortOrder = await nextSortOrder(db, tenantId)

  await uploadObject(objectKey, image.buffer, image.size, image.mimetype)

  try {
    const photo = await insertSharePhoto(db, tenantId, {
      objectKey,
      contentType: image.mimetype,
      label,
      sortOrder,
    })
    return { photo }
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }
}

export async function deletePhoto(db, tenantId, photoId) {
  const objectKey = await getSharePhotoObjectKey(db, photoId, tenantId)
  if (!objectKey) return NOT_FOUND

  const deleted = await deleteSharePhoto(db, photoId, tenantId)
  if (!deleted) return NOT_FOUND

  safeRemove(objectKey, 'Failed to delete share photo object:')
  return {}
}
