// SQL for the pages table. Every function takes the executor first so
// callers stay in control of transactions (none are needed yet — writes are
// single-statement).

export async function upsertPage(executor, slug, tenantId) {
  const { rows } = await executor.query(
    `INSERT INTO pages (slug, gigbuddy_tenant_id)
     VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET gigbuddy_tenant_id = EXCLUDED.gigbuddy_tenant_id
     RETURNING *`,
    [slug, tenantId],
  )
  return rows[0]
}

export async function getPageBySlug(executor, slug) {
  const { rows } = await executor.query('SELECT * FROM pages WHERE slug = $1', [slug])
  return rows[0] || null
}

export async function saveDraftLayout(executor, pageId, layout) {
  await executor.query(
    'UPDATE pages SET draft_layout = $2, updated_at = NOW() WHERE id = $1',
    [pageId, JSON.stringify(layout)],
  )
}

export async function publishDraft(executor, pageId) {
  const { rows } = await executor.query(
    `UPDATE pages
        SET published_layout = draft_layout, published_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [pageId],
  )
  return rows[0] || null
}

export async function unpublish(executor, pageId) {
  await executor.query(
    'UPDATE pages SET published_layout = NULL, published_at = NULL, updated_at = NOW() WHERE id = $1',
    [pageId],
  )
}

export async function saveContent(executor, pageId, content) {
  await executor.query(
    'UPDATE pages SET content = $2, content_synced_at = NOW(), updated_at = NOW() WHERE id = $1',
    [pageId, JSON.stringify(content)],
  )
}
