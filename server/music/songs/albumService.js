import { randomUUID } from 'node:crypto'
import { limitedCollection } from '../../platform/collections/limitedCollectionService.js'
import { badRequest, conflict, notFound } from '../../platform/http/serviceErrors.js'
import {
  albumArtKey,
  removeObject,
  safeRemove,
  uploadObjectWithQuota,
} from '../../platform/files/storageService.js'
import { withFeatureWriteGuard } from '../../commerce/billing/featureGuards.js'
import { FEATURES } from '../../auth/entitlements.js'
import {
  extensionForImageMime,
  IMAGE_PROCESSING_PRESETS,
  validateAndReencodeImage,
} from '../../utils/imageProcess.js'
import {
  clearAlbumArtUrl,
  fetchAlbum,
  getAlbumArtRow,
  insertAlbum,
  listAlbums as listAlbumRows,
  setAlbumArtUrl,
  updateAlbumFields,
} from './albumRepository.js'
import { buildAlbumUpdateFields, normalizeAlbum } from './albumValidators.js'

const NOT_FOUND = notFound('Not found')

export async function listAlbums(db, tenantId, query = {}) {
  const search = String(query.q ?? '').trim()
  return limitedCollection(query.limit, (limit) => listAlbumRows(db, tenantId, search, limit), 25)
}

export async function createAlbum(db, tenantId, body) {
  const normalized = normalizeAlbum(body)
  if (normalized.error) return badRequest(normalized.error)

  try {
    const album = await insertAlbum(db, tenantId, normalized.title, normalized.releaseDate)
    return { album }
  } catch (err) {
    if (err.code === '23505') return conflict('Album title already exists')
    throw err
  }
}

export async function patchAlbum(db, tenantId, albumId, body) {
  const built = buildAlbumUpdateFields(body)
  if (built.error) return badRequest(built.error)
  if (!built.fields.length) return badRequest('No valid fields to update')

  try {
    const album = await updateAlbumFields(db, tenantId, albumId, built.fields, built.values)
    return album ? { album } : NOT_FOUND
  } catch (err) {
    if (err.code === '23505') return conflict('Album title already exists')
    throw err
  }
}

export async function replaceAlbumArt(db, tenantId, albumId, file) {
  const before = await getAlbumArtRow(db, albumId, tenantId)
  if (!before) return NOT_FOUND

  const image = await validateAndReencodeImage(file.buffer, file.mimetype, IMAGE_PROCESSING_PRESETS.songCover)
  const objectKey = albumArtKey(tenantId, randomUUID(), extensionForImageMime(image.mimetype))
  await uploadObjectWithQuota(objectKey, image.buffer, image.size, image.mimetype)

  let updatedUrl
  try {
    updatedUrl = await withFeatureWriteGuard(
      db,
      tenantId,
      FEATURES.CUSTOMIZATION,
      (client) => setAlbumArtUrl(client, albumId, tenantId, objectKey),
      { orphanKey: objectKey },
    )
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }

  if (!updatedUrl) {
    safeRemove(objectKey, 'Failed to delete unused album art object:')
    return NOT_FOUND
  }

  safeRemove(before.album_art_url, 'Failed to delete old album art object:')
  return { album: await fetchAlbum(db, albumId, tenantId) }
}

export async function deleteAlbumArt(db, tenantId, albumId) {
  const before = await getAlbumArtRow(db, albumId, tenantId)
  if (!before) return NOT_FOUND
  if (!(await clearAlbumArtUrl(db, albumId, tenantId))) return NOT_FOUND
  safeRemove(before.album_art_url, 'Failed to delete album art object:')
  return { album: await fetchAlbum(db, albumId, tenantId) }
}
