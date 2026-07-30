const MEMORY_TILE_TYPE = 'memory_tile'

const MEMORY_COLUMNS = Object.freeze({
  memory_image_path: 'image_path',
  memory_caption: 'caption',
  memory_gig_id: 'gig_id',
})

function memoryColumn(field) {
  const column = MEMORY_COLUMNS[field]
  if (!column) throw new Error('Unknown memory tile field')
  return column
}

export async function updateMemoryTile(executor, tenantId, updates) {
  if (updates.length === 0) return
  const columns = updates.map(({ field }) => memoryColumn(field))
  const values = updates.map(({ value }) => value)
  const insertColumns = ['tenant_id', 'type', ...columns]
  const placeholders = insertColumns.map((_, index) => `$${index + 1}`)
  const assignments = columns.map((column) => `${column} = EXCLUDED.${column}`)
  await executor.query(
    `INSERT INTO dashboard_tiles (${insertColumns.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (tenant_id, type)
     DO UPDATE SET ${assignments.join(', ')}, updated_at = NOW()`,
    [tenantId, MEMORY_TILE_TYPE, ...values],
  )
}

export async function getMemoryImagePath(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT image_path
       FROM dashboard_tiles
      WHERE tenant_id = $1 AND type = $2`,
    [tenantId, MEMORY_TILE_TYPE],
  )
  return rows[0]?.image_path || null
}

export async function setMemoryImagePath(executor, tenantId, objectKey) {
  const { rows } = await executor.query(
    `INSERT INTO dashboard_tiles (tenant_id, type, image_path)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, type)
     DO UPDATE SET image_path = EXCLUDED.image_path, updated_at = NOW()
     RETURNING image_path`,
    [tenantId, MEMORY_TILE_TYPE, objectKey],
  )
  return rows[0].image_path
}

export async function clearMemoryTile(executor, tenantId) {
  await executor.query(
    `UPDATE dashboard_tiles
        SET image_path = NULL, caption = NULL, gig_id = NULL, updated_at = NOW()
      WHERE tenant_id = $1 AND type = $2`,
    [tenantId, MEMORY_TILE_TYPE],
  )
}

export async function clearMemoryTileCustomization(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT image_path
       FROM dashboard_tiles
      WHERE tenant_id = $1 AND type = $2
      FOR UPDATE`,
    [tenantId, MEMORY_TILE_TYPE],
  )
  await clearMemoryTile(executor, tenantId)
  return rows[0]?.image_path || null
}
