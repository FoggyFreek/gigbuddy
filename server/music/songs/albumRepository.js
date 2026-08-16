// Tenant-scoped data access for the album catalogue shown inside songs.

export async function listAlbums(executor, tenantId, query, limit) {
  const values = [tenantId]
  let predicate = ''
  let relevance = ''
  if (query) {
    values.push(query, `%${query}%`)
    predicate = 'AND title ILIKE $3'
    relevance = 'CASE WHEN lower(title) = lower($2) THEN 0 ELSE 1 END,'
  }
  values.push(limit)

  const { rows } = await executor.query(
    `SELECT id, tenant_id, title, release_date, album_art_url, created_at, updated_at
       FROM albums
      WHERE tenant_id = $1 ${predicate}
      ORDER BY ${relevance} title ASC, id ASC
      LIMIT $${values.length}`,
    values,
  )
  return rows
}

export async function albumExistsInTenant(executor, albumId, tenantId) {
  const { rowCount } = await executor.query(
    'SELECT 1 FROM albums WHERE id = $1 AND tenant_id = $2',
    [albumId, tenantId],
  )
  return rowCount > 0
}

export async function fetchAlbum(executor, albumId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, tenant_id, title, release_date, album_art_url, created_at, updated_at
       FROM albums WHERE id = $1 AND tenant_id = $2`,
    [albumId, tenantId],
  )
  return rows[0] ?? null
}

export async function insertAlbum(executor, tenantId, title, releaseDate) {
  const { rows } = await executor.query(
    `INSERT INTO albums (tenant_id, title, release_date)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [tenantId, title, releaseDate],
  )
  return rows[0]
}

// CSV imports may reference the same album on many rows. Reuse the tenant's
// case-insensitive title match and only enrich a missing release date.
export async function upsertAlbumForImport(executor, tenantId, title, releaseDate) {
  const { rows } = await executor.query(
    `INSERT INTO albums (tenant_id, title, release_date)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, lower(title)) DO UPDATE SET
       release_date = COALESCE(albums.release_date, EXCLUDED.release_date),
       updated_at = CASE
         WHEN albums.release_date IS NULL AND EXCLUDED.release_date IS NOT NULL THEN NOW()
         ELSE albums.updated_at
       END
     RETURNING id`,
    [tenantId, title, releaseDate],
  )
  return rows[0].id
}

export async function updateAlbumFields(executor, tenantId, albumId, fields, values) {
  const assignments = [...fields, 'updated_at = NOW()']
  const whereIdx = values.length + 1
  const { rows } = await executor.query(
    `UPDATE albums SET ${assignments.join(', ')}
      WHERE id = $${whereIdx} AND tenant_id = $${whereIdx + 1}
      RETURNING *`,
    [...values, albumId, tenantId],
  )
  return rows[0] ?? null
}

export async function getAlbumArtRow(executor, albumId, tenantId) {
  const { rows } = await executor.query(
    'SELECT album_art_url FROM albums WHERE id = $1 AND tenant_id = $2',
    [albumId, tenantId],
  )
  return rows[0] ?? null
}

export async function setAlbumArtUrl(executor, albumId, tenantId, objectKey) {
  const { rows } = await executor.query(
    `UPDATE albums SET album_art_url = $1, updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3 RETURNING album_art_url`,
    [objectKey, albumId, tenantId],
  )
  return rows[0]?.album_art_url ?? null
}

export async function clearAlbumArtUrl(executor, albumId, tenantId) {
  const { rows } = await executor.query(
    `UPDATE albums SET album_art_url = NULL, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2 RETURNING album_art_url`,
    [albumId, tenantId],
  )
  return rows.length > 0
}

export async function clearAlbumArtForTenant(executor, tenantId) {
  const { rows } = await executor.query(
    'SELECT album_art_url FROM albums WHERE tenant_id = $1 AND album_art_url IS NOT NULL',
    [tenantId],
  )
  await executor.query(
    'UPDATE albums SET album_art_url = NULL WHERE tenant_id = $1 AND album_art_url IS NOT NULL',
    [tenantId],
  )
  return rows.map((row) => row.album_art_url)
}
