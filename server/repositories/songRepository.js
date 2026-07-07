// Data-access helpers for songs and their children (tags, links, documents,
// recordings). Each query takes an `executor` (a pool or transaction client) so
// callers control transactions. Every query is scoped by tenant_id.

// ---------- songs ----------

export async function listSongs(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT s.*,
       COALESCE(
         json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
           FILTER (WHERE t.id IS NOT NULL),
         '[]'
       ) AS tags
     FROM songs s
     LEFT JOIN song_tag_links l ON l.song_id = s.id AND l.tenant_id = s.tenant_id
     LEFT JOIN song_tags t ON t.id = l.tag_id AND t.tenant_id = s.tenant_id
     WHERE s.tenant_id = $1
     GROUP BY s.id
     ORDER BY s.title ASC`,
    [tenantId],
  )
  return rows
}

export async function fetchSong(executor, songId, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM songs WHERE id = $1 AND tenant_id = $2',
    [songId, tenantId],
  )
  return rows[0] || null
}

export async function songExistsInTenant(executor, songId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM songs WHERE id = $1 AND tenant_id = $2',
    [songId, tenantId],
  )
  return rowCount > 0
}

export async function searchSongs(executor, tenantId, like) {
  const { rows } = await executor.query(
    `SELECT id, title, artist
       FROM songs
      WHERE tenant_id = $1 AND (title ILIKE $2 OR artist ILIKE $2)
      ORDER BY
        CASE WHEN title ILIKE $2 THEN 0 ELSE 1 END,
        title ASC
      LIMIT 10`,
    [tenantId, like],
  )
  return rows
}

export async function insertSong(executor, tenantId, data) {
  const { rows } = await executor.query(
    `INSERT INTO songs (tenant_id, title, artist, song_key, tempo, duration_seconds, lyrics_html, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      tenantId,
      data.title,
      data.artist,
      data.song_key,
      data.tempo,
      data.duration_seconds,
      data.lyrics_html,
      data.notes,
    ],
  )
  return rows[0]
}

// Applies prebuilt SET fragments (placeholders $1..$N) to a song, appending
// updated_at and the WHERE bindings. Returns the updated row or null.
export async function updateSongFields(executor, tenantId, songId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE songs SET ${assignments.join(', ')}
     WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1} RETURNING *`,
    [...values, songId, tenantId],
  )
  return rows[0] || null
}

// Object keys of all files attached to a song (documents + recordings), gathered
// before the row is deleted so the objects can be removed after the DB commits.
export async function collectSongObjectKeys(executor, songId, tenantId) {
  const { rows } = await executor.query(
    `SELECT object_key FROM song_documents WHERE song_id = $1 AND tenant_id = $2
     UNION ALL
     SELECT object_key FROM song_recordings WHERE song_id = $1 AND tenant_id = $2`,
    [songId, tenantId],
  )
  return rows.map((r) => r.object_key)
}

export async function deleteSong(executor, songId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM songs WHERE id = $1 AND tenant_id = $2',
    [songId, tenantId],
  )
  return rowCount > 0
}

// ---------- tags ----------

export async function searchTags(executor, tenantId, like) {
  const params = [tenantId]
  let where = 'WHERE tenant_id = $1'
  if (like) {
    params.push(like)
    where += ' AND name ILIKE $2'
  }
  const { rows } = await executor.query(
    `SELECT id, name FROM song_tags ${where} ORDER BY name ASC LIMIT 100`,
    params,
  )
  return rows
}

export async function loadSongTags(executor, songId, tenantId) {
  const { rows } = await executor.query(
    `SELECT t.id, t.name
       FROM song_tag_links l
       JOIN song_tags t ON t.id = l.tag_id AND t.tenant_id = l.tenant_id
      WHERE l.song_id = $1 AND l.tenant_id = $2
      ORDER BY t.name ASC`,
    [songId, tenantId],
  )
  return rows
}

// Find-or-create a tag (case-insensitive on name); returns its id.
export async function upsertTag(executor, tenantId, name) {
  const { rows } = await executor.query(
    `INSERT INTO song_tags (tenant_id, name) VALUES ($1, $2)
     ON CONFLICT (tenant_id, lower(name)) DO UPDATE SET name = song_tags.name
     RETURNING id`,
    [tenantId, name],
  )
  return rows[0].id
}

export async function deleteSongTagLinks(executor, songId, tenantId) {
  await executor.query(
    'DELETE FROM song_tag_links WHERE song_id = $1 AND tenant_id = $2',
    [songId, tenantId],
  )
}

export async function insertSongTagLink(executor, songId, tagId, tenantId) {
  await executor.query(
    'INSERT INTO song_tag_links (song_id, tag_id, tenant_id) VALUES ($1, $2, $3)',
    [songId, tagId, tenantId],
  )
}

// Import variant: tolerates an existing link so re-imports don't fail.
export async function insertSongTagLinkIgnore(executor, songId, tagId, tenantId) {
  await executor.query(
    `INSERT INTO song_tag_links (song_id, tag_id, tenant_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [songId, tagId, tenantId],
  )
}

// ---------- links ----------

export async function loadSongLinks(executor, songId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, label, url, sort_order
       FROM song_links WHERE song_id = $1 AND tenant_id = $2
      ORDER BY sort_order ASC, id ASC`,
    [songId, tenantId],
  )
  return rows
}

export async function nextLinkSortOrder(executor, songId, tenantId) {
  const { rows } = await executor.query(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM song_links WHERE song_id = $1 AND tenant_id = $2',
    [songId, tenantId],
  )
  return rows[0].next
}

// Inserts a link only when the parent song belongs to the tenant (the SELECT
// guard). Returns the new link row, or null when the song doesn't exist.
export async function insertSongLink(executor, songId, tenantId, label, url, sortOrder) {
  const { rows } = await executor.query(
    `INSERT INTO song_links (song_id, tenant_id, label, url, sort_order)
     SELECT s.id, s.tenant_id, $3, $4, $5
     FROM songs s WHERE s.id = $1 AND s.tenant_id = $2
     RETURNING id, label, url, sort_order`,
    [songId, tenantId, label, url, sortOrder],
  )
  return rows[0] || null
}

// Applies prebuilt SET fragments to a song link. Returns the updated row or null.
export async function updateSongLinkFields(executor, tenantId, songId, linkId, fields, values) {
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE song_links SET ${fields.join(', ')}
     WHERE id = $${whereIdx} AND song_id = $${whereIdx + 1} AND tenant_id = $${whereIdx + 2}
     RETURNING id, label, url, sort_order`,
    [...values, linkId, songId, tenantId],
  )
  return rows[0] || null
}

export async function deleteSongLink(executor, linkId, songId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM song_links WHERE id = $1 AND song_id = $2 AND tenant_id = $3',
    [linkId, songId, tenantId],
  )
  return rowCount > 0
}

// ---------- documents ----------

export async function loadSongDocuments(executor, songId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, object_key, original_filename, content_type, file_size, uploaded_at
       FROM song_documents WHERE song_id = $1 AND tenant_id = $2
      ORDER BY uploaded_at ASC`,
    [songId, tenantId],
  )
  return rows
}

export async function insertSongDocument(executor, songId, tenantId, file, objectKey) {
  const { rows } = await executor.query(
    `INSERT INTO song_documents (song_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, object_key, original_filename, content_type, file_size, uploaded_at`,
    [songId, tenantId, objectKey, file.originalname, file.mimetype, file.size],
  )
  return rows[0]
}

export async function deleteSongDocument(executor, docId, songId, tenantId) {
  const { rows } = await executor.query(
    'DELETE FROM song_documents WHERE id = $1 AND song_id = $2 AND tenant_id = $3 RETURNING object_key',
    [docId, songId, tenantId],
  )
  return rows[0]?.object_key ?? null
}

// ---------- recordings ----------

export async function loadSongRecordings(executor, songId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, object_key, original_filename, content_type, file_size, uploaded_at
       FROM song_recordings WHERE song_id = $1 AND tenant_id = $2
      ORDER BY uploaded_at ASC`,
    [songId, tenantId],
  )
  return rows
}

export async function insertSongRecording(executor, songId, tenantId, file, objectKey) {
  const { rows } = await executor.query(
    `INSERT INTO song_recordings (song_id, tenant_id, object_key, original_filename, content_type, file_size)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, object_key, original_filename, content_type, file_size, uploaded_at`,
    [songId, tenantId, objectKey, file.originalname, file.mimetype, file.size],
  )
  return rows[0]
}

export async function deleteSongRecording(executor, recId, songId, tenantId) {
  const { rows } = await executor.query(
    'DELETE FROM song_recordings WHERE id = $1 AND song_id = $2 AND tenant_id = $3 RETURNING object_key',
    [recId, songId, tenantId],
  )
  return rows[0]?.object_key ?? null
}

// ---------- chordpro charts ----------

export async function loadSongCharts(executor, songId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, name, source, created_at, updated_at
       FROM song_chordpro_charts WHERE song_id = $1 AND tenant_id = $2
      ORDER BY created_at ASC, id ASC`,
    [songId, tenantId],
  )
  return rows
}

// Inserts a chart only when the parent song belongs to the tenant (the SELECT
// guard). Returns the new chart row, or null when the song doesn't exist.
export async function insertSongChart(executor, songId, tenantId, name, source) {
  const { rows } = await executor.query(
    `INSERT INTO song_chordpro_charts (song_id, tenant_id, name, source)
     SELECT s.id, s.tenant_id, $3, $4
     FROM songs s WHERE s.id = $1 AND s.tenant_id = $2
     RETURNING id, name, source, created_at, updated_at`,
    [songId, tenantId, name, source],
  )
  return rows[0] || null
}

// Applies prebuilt SET fragments to a chart. Returns the updated row or null.
export async function updateSongChartFields(executor, tenantId, songId, chartId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE song_chordpro_charts SET ${assignments.join(', ')}
     WHERE id = $${whereIdx} AND song_id = $${whereIdx + 1} AND tenant_id = $${whereIdx + 2}
     RETURNING id, name, source, created_at, updated_at`,
    [...values, chartId, songId, tenantId],
  )
  return rows[0] || null
}

export async function deleteSongChart(executor, chartId, songId, tenantId) {
  const { rowCount } = await executor.query(
    'DELETE FROM song_chordpro_charts WHERE id = $1 AND song_id = $2 AND tenant_id = $3',
    [chartId, songId, tenantId],
  )
  return rowCount > 0
}

// ---------- downgrade purge (whole-tenant deletes) ----------

// Every stored song file object key of a tenant (documents + recordings),
// collected before the rows are deleted so the objects can be queued for
// storage cleanup.
export async function listSongFileKeysForTenant(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT object_key FROM song_documents WHERE tenant_id = $1
     UNION ALL
     SELECT object_key FROM song_recordings WHERE tenant_id = $1`,
    [tenantId],
  )
  return rows.map((r) => r.object_key)
}

export async function deleteSongFilesForTenant(executor, tenantId) {
  await executor.query('DELETE FROM song_documents WHERE tenant_id = $1', [tenantId])
  await executor.query('DELETE FROM song_recordings WHERE tenant_id = $1', [tenantId])
}

export async function deleteSongChartsForTenant(executor, tenantId) {
  await executor.query('DELETE FROM song_chordpro_charts WHERE tenant_id = $1', [tenantId])
}

// ---------- import ----------

// Lowercased (title, artist) keys of existing songs, used to dedupe an import.
export async function loadExistingSongKeys(executor, tenantId) {
  const { rows } = await executor.query(
    "SELECT lower(title) AS title, lower(coalesce(artist, '')) AS artist FROM songs WHERE tenant_id = $1",
    [tenantId],
  )
  return rows
}

export async function insertImportSong(executor, tenantId, row) {
  const { rows } = await executor.query(
    `INSERT INTO songs (tenant_id, title, artist, song_key, tempo, duration_seconds)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, row.title, row.artist || null, row.song_key || null, row.tempo, row.duration_seconds],
  )
  return rows[0].id
}
