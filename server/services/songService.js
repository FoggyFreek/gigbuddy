// Song domain logic. Route handlers stay thin and delegate here. Functions that
// can fail with a specific HTTP outcome return { error: { status, body } };
// success returns a domain payload (see each function).
//
// File-upload helpers (documents/recordings) mirror createGigAttachment: verify
// the parent belongs to the tenant, verify the file's magic bytes match its
// declared type, upload to object storage, then insert the DB row — rolling the
// object back if the insert fails so nothing is orphaned.
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import pool from '../db/index.js'
import {
  uploadObject,
  removeObject,
  safeRemove,
  songDocumentKey,
  songRecordingKey,
} from './storageService.js'
import { verifyDocumentContent, verifyAudioContent } from '../utils/verifyFileContent.js'
import {
  trimOrNull,
  toIntOrNull,
  buildSongUpdateFields,
  buildSongLinkUpdateFields,
  normalizeTagNames,
  normalizeChartName,
  normalizeChartSource,
  buildSongChartUpdateFields,
  CHART_SOURCE_MAX,
  normalizeImportRow,
} from '../validators/songValidators.js'
import {
  listSongs as listSongRows,
  fetchSong,
  songExistsInTenant,
  searchSongs as searchSongRows,
  insertSong,
  updateSongFields,
  collectSongObjectKeys,
  deleteSong as deleteSongRow,
  searchTags as searchTagRows,
  loadSongTags,
  upsertTag,
  deleteSongTagLinks,
  insertSongTagLink,
  insertSongTagLinkIgnore,
  loadSongLinks,
  nextLinkSortOrder,
  insertSongLink,
  updateSongLinkFields,
  deleteSongLink as deleteSongLinkRow,
  loadSongDocuments,
  insertSongDocument,
  deleteSongDocument as deleteSongDocumentRow,
  loadSongRecordings,
  insertSongRecording,
  deleteSongRecording as deleteSongRecordingRow,
  loadSongCharts,
  insertSongChart,
  updateSongChartFields,
  deleteSongChart as deleteSongChartRow,
  loadExistingSongKeys,
  insertImportSong,
} from '../repositories/songRepository.js'

const NOT_FOUND = { error: { status: 404, body: { error: 'Not found' } } }

function badRequest(error) {
  return { error: { status: 400, body: { error } } }
}

// ---------- reads ----------

export async function listSongs(db, tenantId) {
  return listSongRows(db, tenantId)
}

export async function searchSongs(db, tenantId, q) {
  const trimmed = String(q ?? '').trim()
  if (trimmed.length < 3) return []
  return searchSongRows(db, tenantId, `%${trimmed}%`)
}

export async function searchTags(db, tenantId, q) {
  const trimmed = String(q ?? '').trim()
  return searchTagRows(db, tenantId, trimmed ? `%${trimmed}%` : null)
}

// Returns the song with its child collections, or NOT_FOUND. Children load with
// separate queries — a single multi-LEFT-JOIN would produce cross-product
// duplicates across tags/links/documents/recordings.
export async function getSong(db, tenantId, songId) {
  const song = await fetchSong(db, songId, tenantId)
  if (!song) return NOT_FOUND
  const [tags, links, documents, recordings, chordpro_charts] = await Promise.all([
    loadSongTags(db, songId, tenantId),
    loadSongLinks(db, songId, tenantId),
    loadSongDocuments(db, songId, tenantId),
    loadSongRecordings(db, songId, tenantId),
    loadSongCharts(db, songId, tenantId),
  ])
  return { song: { ...song, tags, links, documents, recordings, chordpro_charts } }
}

// ---------- writes ----------

export async function createSong(db, tenantId, body) {
  const title = trimOrNull(body.title)
  if (!title) return badRequest('title is required')
  const song = await insertSong(db, tenantId, {
    title,
    artist: trimOrNull(body.artist),
    song_key: trimOrNull(body.song_key),
    tempo: toIntOrNull(body.tempo),
    duration_seconds: toIntOrNull(body.duration_seconds),
    lyrics_html: body.lyrics_html ?? null,
    notes: trimOrNull(body.notes),
  })
  return { song }
}

export async function patchSong(db, tenantId, songId, body) {
  const built = buildSongUpdateFields(body)
  if (built.error) return badRequest(built.error)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const song = await updateSongFields(db, tenantId, songId, built.fields, built.values)
  if (!song) return NOT_FOUND
  return { song }
}

// Collects object keys first, deletes the row (cascade clears child rows), then
// removes the objects. Never remove objects before the DB delete commits.
export async function deleteSong(db, tenantId, songId) {
  const keys = await collectSongObjectKeys(db, songId, tenantId)
  const deleted = await deleteSongRow(db, songId, tenantId)
  if (!deleted) return NOT_FOUND
  for (const key of keys) {
    safeRemove(key, 'Failed to delete song file object:')
  }
  return {}
}

// ---------- tags ----------

// Replace a song's tag set. Find-or-create each tag (case-insensitive) and
// rewrite the join rows, all in one transaction.
export async function setSongTags(tenantId, songId, body) {
  if (!Array.isArray(body?.tags)) return badRequest('tags must be an array')
  const names = normalizeTagNames(body.tags)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!(await songExistsInTenant(client, songId, tenantId))) {
      await client.query('ROLLBACK')
      return NOT_FOUND
    }

    const tagIds = []
    for (const name of names) {
      tagIds.push(await upsertTag(client, tenantId, name))
    }

    await deleteSongTagLinks(client, songId, tenantId)
    for (const tagId of tagIds) {
      await insertSongTagLink(client, songId, tagId, tenantId)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return { tags: await loadSongTags(pool, songId, tenantId) }
}

// ---------- links ----------

export async function createSongLink(db, tenantId, songId, body) {
  const url = trimOrNull(body.url)
  if (!url) return badRequest('url is required')

  const sortOrder = await nextLinkSortOrder(db, songId, tenantId)
  const link = await insertSongLink(db, songId, tenantId, trimOrNull(body.label), url, sortOrder)
  if (!link) return NOT_FOUND
  return { link }
}

export async function patchSongLink(db, tenantId, songId, linkId, body) {
  const built = buildSongLinkUpdateFields(body)
  if (built.error) return badRequest(built.error)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const link = await updateSongLinkFields(db, tenantId, songId, linkId, built.fields, built.values)
  if (!link) return NOT_FOUND
  return { link }
}

export async function deleteSongLink(db, tenantId, songId, linkId) {
  const removed = await deleteSongLinkRow(db, linkId, songId, tenantId)
  return removed ? {} : NOT_FOUND
}

// ---------- documents (pdf) ----------

export async function createSongDocument(db, tenantId, songId, file) {
  if (!(await songExistsInTenant(db, songId, tenantId))) return NOT_FOUND
  if (!verifyDocumentContent(file.buffer, file.mimetype)) {
    return badRequest('File content does not match declared type')
  }

  const ext = path.extname(file.originalname).toLowerCase()
  const objectKey = songDocumentKey(tenantId, randomUUID(), ext)

  await uploadObject(objectKey, file.buffer, file.size, file.mimetype)

  try {
    return { document: await insertSongDocument(db, songId, tenantId, file, objectKey) }
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }
}

export async function deleteSongDocument(db, tenantId, songId, docId) {
  const objectKey = await deleteSongDocumentRow(db, docId, songId, tenantId)
  if (!objectKey) return NOT_FOUND
  safeRemove(objectKey, 'Failed to delete song document object:')
  return {}
}

// ---------- recordings (mp3) ----------

export async function createSongRecording(db, tenantId, songId, file) {
  if (!(await songExistsInTenant(db, songId, tenantId))) return NOT_FOUND
  if (!verifyAudioContent(file.buffer)) {
    return badRequest('File content does not look like an mp3')
  }

  const ext = path.extname(file.originalname).toLowerCase()
  const objectKey = songRecordingKey(tenantId, randomUUID(), ext)

  await uploadObject(objectKey, file.buffer, file.size, file.mimetype)

  try {
    return { recording: await insertSongRecording(db, songId, tenantId, file, objectKey) }
  } catch (err) {
    removeObject(objectKey).catch(() => {})
    throw err
  }
}

export async function deleteSongRecording(db, tenantId, songId, recId) {
  const objectKey = await deleteSongRecordingRow(db, recId, songId, tenantId)
  if (!objectKey) return NOT_FOUND
  safeRemove(objectKey, 'Failed to delete song recording object:')
  return {}
}

// ---------- chordpro charts ----------

// Create a chart from { name, source }. Both routes (JSON body and file upload)
// funnel through here; the route derives a default name from the filename when
// the upload omits one. insertSongChart's SELECT guard returns null (→ 404) when
// the song isn't in the tenant, so no separate existence check is needed.
export async function createSongChart(db, tenantId, songId, body) {
  const name = normalizeChartName(body.name) || 'Chart'
  const source = normalizeChartSource(body.source)
  if (source.length > CHART_SOURCE_MAX) return badRequest('source is too large')

  const chart = await insertSongChart(db, songId, tenantId, name, source)
  if (!chart) return NOT_FOUND
  return { chart }
}

export async function patchSongChart(db, tenantId, songId, chartId, body) {
  const built = buildSongChartUpdateFields(body)
  if (built.error) return badRequest(built.error)
  if (!built.fields.length) return badRequest('No valid fields to update')

  const chart = await updateSongChartFields(db, tenantId, songId, chartId, built.fields, built.values)
  if (!chart) return NOT_FOUND
  return { chart }
}

export async function deleteSongChart(db, tenantId, songId, chartId) {
  const removed = await deleteSongChartRow(db, chartId, songId, tenantId)
  return removed ? {} : NOT_FOUND
}

// ---------- import ----------

// Bulk import; duplicates (against the DB or within the batch, keyed on
// lowercased title+artist) are skipped, all inserts happen in one transaction.
export async function importSongs(tenantId, body) {
  if (!Array.isArray(body) || body.length === 0) {
    return badRequest('Expected non-empty array')
  }
  if (body.length > 1000) {
    return badRequest('Maximum 1000 rows per import')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const existingRows = await loadExistingSongKeys(client, tenantId)
    const existingKeys = new Set(existingRows.map((r) => `${r.title} ${r.artist}`))

    let imported = 0
    let skipped = 0
    const seenKeys = new Set()

    for (const raw of body) {
      const row = normalizeImportRow(raw)
      if (!row.title) { skipped++; continue }
      const key = `${row.title.toLowerCase()} ${row.artist.toLowerCase()}`
      if (existingKeys.has(key) || seenKeys.has(key)) { skipped++; continue }

      const songId = await insertImportSong(client, tenantId, row)
      for (const name of new Set(row.tags)) {
        const tagId = await upsertTag(client, tenantId, name)
        await insertSongTagLinkIgnore(client, songId, tagId, tenantId)
      }

      imported++
      seenKeys.add(key)
    }
    await client.query('COMMIT')
    return { summary: { imported, skipped } }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
