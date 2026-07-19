// SQL for the pages table. Every function takes the executor first so
// callers stay in control of transactions (none are needed yet — writes are
// single-statement).

// Get-or-create the tenant's main page. Returns the row, or null when the slug
// is already taken by a DIFFERENT tenant or by a non-main (release) row.
//
// The `pages.slug` namespace is global and shared with release-page slugs
// (which must merely start with the band's main slug), so tenant A's release
// `foo-bar` can collide with tenant B's legitimate main slug `foo-bar`. The
// conflict update is therefore guarded to the SAME tenant AND page_type='main':
// a foreign or release row leaves RETURNING empty instead of silently
// transferring ownership / corrupting the row. The caller turns null into a
// 409 rather than opening an editor session onto someone else's data.
export async function upsertMainPage(executor, slug, tenantId) {
  const { rows } = await executor.query(
    `INSERT INTO pages (slug, gigbuddy_tenant_id, page_type)
     VALUES ($1, $2, 'main')
     ON CONFLICT (slug) DO UPDATE
       SET updated_at = NOW()
       WHERE pages.gigbuddy_tenant_id = EXCLUDED.gigbuddy_tenant_id
         AND pages.page_type = 'main'
     RETURNING *`,
    [slug, tenantId],
  )
  return rows[0] || null
}

export async function getPageBySlug(executor, slug) {
  const { rows } = await executor.query('SELECT * FROM pages WHERE slug = $1', [slug])
  return rows[0] || null
}

// Tenant-scoped id lookup: a session for band A must never load band B's
// page, so the tenant id is part of the WHERE, not an afterthought.
export async function getPageForTenant(executor, pageId, tenantId) {
  const { rows } = await executor.query(
    'SELECT * FROM pages WHERE id = $1 AND gigbuddy_tenant_id = $2',
    [pageId, tenantId],
  )
  return rows[0] || null
}

export async function listPagesForTenant(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, slug, page_type, release, published_at
       FROM pages
      WHERE gigbuddy_tenant_id = $1
      ORDER BY (page_type = 'main') DESC, created_at ASC`,
    [tenantId],
  )
  return rows
}

// Release landing page. Returns null on a slug collision (caller turns that
// into a 409) instead of throwing.
export async function insertReleasePage(executor, slug, tenantId, release, layout, content) {
  const { rows } = await executor.query(
    `INSERT INTO pages (slug, gigbuddy_tenant_id, page_type, release, draft_layout, content, content_synced_at)
     VALUES ($1, $2, 'release', $3, $4, $5, NOW())
     ON CONFLICT (slug) DO NOTHING
     RETURNING *`,
    [slug, tenantId, JSON.stringify(release), JSON.stringify(layout), JSON.stringify(content)],
  )
  return rows[0] || null
}

// Only release pages can be deleted — the main page is the band's anchor.
export async function deleteReleasePage(executor, pageId, tenantId) {
  const { rowCount } = await executor.query(
    `DELETE FROM pages WHERE id = $1 AND gigbuddy_tenant_id = $2 AND page_type = 'release'`,
    [pageId, tenantId],
  )
  return rowCount > 0
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
