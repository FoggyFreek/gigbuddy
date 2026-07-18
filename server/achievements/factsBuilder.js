import { monthlyResultTotals } from '../repositories/ledgerRepository.js'

// Builds the flat, primitive-valued facts object that achievement predicates
// (server/achievements/definitions.js) run against. This file owns all the
// aggregate SQL for the achievements domain; definitions stay SQL-free.
// Anything "now"-derived (tenant age, completed-month window) is computed here
// so predicates stay pure.

const nonBlank = (v) => typeof v === 'string' && v.trim() !== ''

async function tenantFacts(db, tenantId) {
  const { rows } = await db.query(
    `SELECT band_name, bio, logo_path, logo_dark_path, avatar_path, banner_path,
            instagram_handle, facebook_handle, tiktok_handle, youtube_handle, spotify_handle,
            (bandsintown_app_id_encrypted IS NOT NULL OR
              NULLIF(BTRIM(bandsintown_app_id), '') IS NOT NULL) AS bandsintown_configured,
            (NULLIF(BTRIM(shopify_client_id), '') IS NOT NULL AND
              (shopify_client_secret_encrypted IS NOT NULL OR
                NULLIF(BTRIM(shopify_client_secret), '') IS NOT NULL) AND
              NULLIF(BTRIM(shopify_shop_domain), '') IS NOT NULL) AS shopify_configured,
            (mollie_api_key_retained_at IS NULL AND
              (mollie_api_key_encrypted IS NOT NULL OR
                NULLIF(BTRIM(mollie_api_key), '') IS NOT NULL)) AS mollie_configured,
            created_at
       FROM tenants
      WHERE id = $1`,
    [tenantId],
  )
  const t = rows[0] ?? {}
  const socialsCount = [
    t.instagram_handle,
    t.facebook_handle,
    t.tiktok_handle,
    t.youtube_handle,
    t.spotify_handle,
  ].filter(nonBlank).length
  const ageDays = t.created_at
    ? Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86_400_000)
    : 0
  return {
    profile: {
      hasBandName: nonBlank(t.band_name),
      hasBio: nonBlank(t.bio),
      hasLogo: nonBlank(t.logo_path),
      hasDarkLogo: nonBlank(t.logo_dark_path),
      hasAvatar: nonBlank(t.avatar_path),
      hasBanner: nonBlank(t.banner_path),
      socialsCount,
    },
    integrations: {
      bandsintownConfigured: t.bandsintown_configured,
      shopifyConfigured: t.shopify_configured,
      mollieConfigured: t.mollie_configured,
    },
    tenant: { ageDays },
  }
}

async function memberFacts(db, tenantId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE position = 'optional')::int AS optional,
            COUNT(*) FILTER (WHERE position = 'sub')::int AS subs
       FROM band_members
      WHERE tenant_id = $1`,
    [tenantId],
  )
  const invites = await db.query(
    `SELECT COUNT(*)::int AS redeemed
       FROM tenant_invites
      WHERE tenant_id = $1 AND used_by_user_id IS NOT NULL`,
    [tenantId],
  )
  return { members: { ...rows[0], redeemedInvites: invites.rows[0].redeemed } }
}

async function gigFacts(db, tenantId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE g.status <> 'option')::int AS non_option,
            COUNT(DISTINCT v.city) FILTER (
              WHERE g.status <> 'option' AND g.event_date < CURRENT_DATE
                AND v.city IS NOT NULL AND v.city <> ''
            )::int AS played_cities,
            COUNT(DISTINCT v.country) FILTER (
              WHERE g.status <> 'option' AND g.event_date < CURRENT_DATE
                AND v.country IS NOT NULL
            )::int AS played_countries
       FROM gigs g
       LEFT JOIN venues v ON v.id = g.venue_id AND v.tenant_id = g.tenant_id
      WHERE g.tenant_id = $1`,
    [tenantId],
  )
  const r = rows[0]
  return {
    gigs: {
      total: r.total,
      nonOption: r.non_option,
      playedCities: r.played_cities,
      playedCountries: r.played_countries,
    },
  }
}

async function planningFacts(db, tenantId) {
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM rehearsals  WHERE tenant_id = $1)::int AS rehearsals,
            (SELECT COUNT(*) FROM band_events WHERE tenant_id = $1)::int AS band_events`,
    [tenantId],
  )
  return { planning: { rehearsals: rows[0].rehearsals, bandEvents: rows[0].band_events } }
}

async function billingDocFacts(db, tenantId) {
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM invoices
              WHERE tenant_id = $1 AND status IN ('sent', 'paid'))::int AS invoices_sent,
            (SELECT COUNT(*) FROM purchases
              WHERE tenant_id = $1 AND status IN ('approved', 'paid'))::int AS purchases_booked`,
    [tenantId],
  )
  return {
    invoices: { sent: rows[0].invoices_sent },
    purchases: { booked: rows[0].purchases_booked },
  }
}

async function merchFacts(db, tenantId) {
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM products WHERE tenant_id = $1)::int AS products,
            (SELECT COUNT(*) FROM purchase_lines pl
               JOIN purchases p ON p.id = pl.purchase_id AND p.tenant_id = pl.tenant_id
              WHERE pl.tenant_id = $1 AND pl.product_id IS NOT NULL
                AND p.status IN ('approved', 'paid'))::int AS inventory_orders,
            (SELECT COUNT(*) FROM merch_sales
              WHERE tenant_id = $1 AND status = 'recorded')::int AS sales`,
    [tenantId],
  )
  return {
    merch: {
      products: rows[0].products,
      inventoryOrders: rows[0].inventory_orders,
      sales: rows[0].sales,
    },
  }
}

async function financeFacts(db, tenantId) {
  // Only completed calendar months count; monthlyResultTotals already excludes
  // open-period-voided entries via EXCLUDE_VOIDED_SQL.
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const toExclusive = monthStart.toISOString().slice(0, 10)
  const months = await monthlyResultTotals(db, tenantId, { from: '1970-01-01', toExclusive })
  return {
    finance: {
      hasProfitableMonth: months.some((m) => m.revenue_cents - m.expense_cents > 0),
      hasLossMonth: months.some((m) => m.revenue_cents - m.expense_cents < 0),
    },
  }
}

async function repertoireFacts(db, tenantId) {
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM songs WHERE tenant_id = $1)::int AS songs,
            COALESCE((SELECT MAX(song_count) FROM (
              SELECT COUNT(*) AS song_count
                FROM setlist_items si
                JOIN setlist_sets ss ON ss.id = si.set_id AND ss.tenant_id = si.tenant_id
               WHERE si.tenant_id = $1 AND si.item_type = 'song'
               GROUP BY ss.setlist_id
            ) counts), 0)::int AS max_setlist_songs,
            EXISTS (
              SELECT 1
                FROM setlist_item_notes sin
                JOIN setlist_items si
                  ON si.id = sin.setlist_item_id AND si.tenant_id = sin.tenant_id
               WHERE sin.tenant_id = $1 AND si.item_type = 'song'
                 AND BTRIM(sin.note) <> ''
            ) AS has_personal_setlist_note,
            EXISTS (
              SELECT 1 FROM songs
               WHERE tenant_id = $1 AND NULLIF(BTRIM(cover_image_path), '') IS NOT NULL
            ) AS has_song_cover,
            EXISTS (
              SELECT 1 FROM song_links WHERE tenant_id = $1
            ) AS has_song_link,
            EXISTS (
              SELECT 1 FROM song_recordings WHERE tenant_id = $1
            ) AS has_song_recording`,
    [tenantId],
  )
  return {
    repertoire: {
      songs: rows[0].songs,
      maxSetlistSongs: rows[0].max_setlist_songs,
      hasPersonalSetlistNote: rows[0].has_personal_setlist_note,
      hasSongCover: rows[0].has_song_cover,
      hasSongLink: rows[0].has_song_link,
      hasSongRecording: rows[0].has_song_recording,
    },
  }
}

async function networkFacts(db, tenantId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS contacts FROM contacts WHERE tenant_id = $1`,
    [tenantId],
  )
  return { network: { contacts: rows[0].contacts } }
}

export async function buildFacts(db, tenantId) {
  const parts = await Promise.all([
    tenantFacts(db, tenantId),
    memberFacts(db, tenantId),
    gigFacts(db, tenantId),
    planningFacts(db, tenantId),
    billingDocFacts(db, tenantId),
    merchFacts(db, tenantId),
    financeFacts(db, tenantId),
    repertoireFacts(db, tenantId),
    networkFacts(db, tenantId),
  ])
  return Object.assign({}, ...parts)
}
