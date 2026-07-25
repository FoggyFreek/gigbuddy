// Read-only aggregate queries for the link-page content export. This is its
// own aggregate (a public, denormalized projection of profile + songs + merch
// + gigs), so its queries live here rather than being stitched from the
// per-resource repositories' interactive loaders.

export async function getTenantBySlug(executor, slug) {
  const { rows } = await executor.query(
    `SELECT id, slug, band_name, bio,
            instagram_handle, facebook_handle, tiktok_handle, youtube_handle, spotify_handle,
            logo_path
       FROM tenants
      WHERE slug = $1 AND archived_at IS NULL`,
    [slug],
  )
  return rows[0] || null
}

export async function getTenantSlug(executor, tenantId) {
  const { rows } = await executor.query('SELECT slug FROM tenants WHERE id = $1', [tenantId])
  return rows[0]?.slug || null
}

export async function listProfileLinks(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, label, url
       FROM profile_links
      WHERE tenant_id = $1
      ORDER BY sort_order, id`,
    [tenantId],
  )
  return rows
}

// Songs that carry at least one external link — the only ones a public
// "listen" widget can point somewhere. Links come back ordered per song.
export async function listSongsWithLinks(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT s.id, s.title, s.artist, s.cover_image_path,
            json_agg(
              json_build_object('label', l.label, 'url', l.url)
              ORDER BY l.sort_order, l.id
            ) AS links
       FROM songs s
       JOIN song_links l ON l.song_id = s.id AND l.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1
      GROUP BY s.id
      ORDER BY s.title, s.id`,
    [tenantId],
  )
  return rows
}

export async function listActiveProducts(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, name, default_price_incl_cents
       FROM products
      WHERE tenant_id = $1 AND archived_at IS NULL
      ORDER BY name, id`,
    [tenantId],
  )
  return rows
}

// Only 'announced' gigs are public by definition; options and unannounced
// confirmations must never leak onto a public page.
export async function listAnnouncedUpcomingGigs(executor, tenantId, limit) {
  const { rows } = await executor.query(
    `SELECT g.id, g.event_date, g.start_time, g.event_description,
            v.name AS venue, v.city
       FROM gigs g
       LEFT JOIN venues v ON v.id = g.venue_id AND v.tenant_id = g.tenant_id
      WHERE g.tenant_id = $1 AND g.status = 'announced' AND g.event_date >= CURRENT_DATE
      ORDER BY g.event_date ASC, g.id ASC
      LIMIT $2`,
    [tenantId, limit],
  )
  return rows
}
