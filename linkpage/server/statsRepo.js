// SQL for visit statistics. Reads are aggregate-only by design: the editor
// UI shows counts per dimension, never individual view rows.

export async function insertView(executor, pageId, { device, source, country, visitorHash }) {
  await executor.query(
    `INSERT INTO page_views (page_id, device, source, country, visitor_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [pageId, device, source, country, visitorHash],
  )
}

export async function insertClick(executor, pageId, { target, device, source, country, visitorHash }) {
  await executor.query(
    `INSERT INTO page_clicks (page_id, target, device, source, country, visitor_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [pageId, target, device, source, country, visitorHash],
  )
}

async function countBy(executor, pageId, since, table, column, limit) {
  const { rows } = await executor.query(
    `SELECT ${column} AS key, COUNT(*)::int AS views
       FROM ${table}
      WHERE page_id = $1 AND occurred_at >= $2
      GROUP BY ${column}
      ORDER BY views DESC, key
      LIMIT $3`,
    [pageId, since, limit],
  )
  return rows
}

// Views, outbound clicks, and the conversion view: clicks per platform/target
// and a per-source table combining views + clicks into a click-through rate —
// the launch-campaign question ("which channel converts?") in one payload.
export async function aggregateStats(executor, pageId, since) {
  const [
    { rows: totals },
    { rows: clickTotals },
    byDevice,
    bySource,
    byCountry,
    byTarget,
    clicksBySource,
    { rows: byDay },
  ] = await Promise.all([
    executor.query(
      `SELECT COUNT(*)::int AS views,
              COUNT(DISTINCT (visitor_hash, occurred_at::date))::int AS unique_visits
         FROM page_views
        WHERE page_id = $1 AND occurred_at >= $2`,
      [pageId, since],
    ),
    // Share events ('share:…') are page amplification and embed plays
    // ('embed:…') are on-page engagement — neither is outbound conversion, so
    // both stay visible in byTarget but are excluded from the click totals
    // that feed the click-through rate.
    executor.query(
      `SELECT COUNT(*)::int AS clicks
         FROM page_clicks
        WHERE page_id = $1 AND occurred_at >= $2
          AND target NOT LIKE 'share:%' AND target NOT LIKE 'embed:%'`,
      [pageId, since],
    ),
    countBy(executor, pageId, since, 'page_views', 'device', 10),
    countBy(executor, pageId, since, 'page_views', 'source', 12),
    countBy(executor, pageId, since, 'page_views', 'country', 12),
    countBy(executor, pageId, since, 'page_clicks', 'target', 15),
    executor.query(
      `SELECT source AS key, COUNT(*)::int AS views
         FROM page_clicks
        WHERE page_id = $1 AND occurred_at >= $2
          AND target NOT LIKE 'share:%' AND target NOT LIKE 'embed:%'
        GROUP BY source
        ORDER BY views DESC, key
        LIMIT 12`,
      [pageId, since],
    ).then((r) => r.rows),
    executor.query(
      `SELECT occurred_at::date AS day, COUNT(*)::int AS views
         FROM page_views
        WHERE page_id = $1 AND occurred_at >= $2
        GROUP BY day
        ORDER BY day`,
      [pageId, since],
    ),
  ])

  const totalViews = totals[0].views
  const totalClicks = clickTotals[0].clicks
  const clicksMap = new Map(clicksBySource.map((r) => [r.key, r.views]))
  const conversionBySource = bySource.map((row) => {
    const clicks = clicksMap.get(row.key) || 0
    return {
      key: row.key,
      views: row.views,
      clicks,
      ctr: row.views ? Math.round((clicks / row.views) * 1000) / 10 : null,
    }
  })

  return {
    totalViews,
    uniqueVisits: totals[0].unique_visits,
    totalClicks,
    clickThroughRate: totalViews ? Math.round((totalClicks / totalViews) * 1000) / 10 : null,
    byDevice,
    bySource,
    byCountry,
    byTarget: byTarget.map((r) => ({ key: r.key, clicks: r.views })),
    conversionBySource,
    byDay: byDay.map((r) => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day,
      views: r.views,
    })),
  }
}

// Retention: raw view/click events fall out of a rolling window — the page's
// plan window (content.entitlements.statsRetentionDays, synced from GigBuddy;
// 30 or 90 days) when present, else the caller's default, hard-capped at 90.
// Normalize a configured retention default to an integer in [1, 90]; anything
// missing, non-numeric, zero, or negative falls back to 30. A negative value
// would otherwise put the cutoff in the FUTURE and delete every row.
export function normalizeRetentionDays(value) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 1) return 30
  return Math.min(n, 90)
}

// GREATEST(1, LEAST(..., 90)) clamps BOTH the per-page window and the default
// into [1, 90] in SQL too — belt and suspenders, so no configuration or synced
// value can ever produce a future cutoff that wipes all statistics.
const RETENTION_PREDICATE = `
  occurred_at < NOW() - make_interval(days =>
    GREATEST(1, LEAST(COALESCE((p.content->'entitlements'->>'statsRetentionDays')::int, $1), 90)))`

export async function purgeOldViews(executor, defaultRetentionDays) {
  const { rowCount } = await executor.query(
    `DELETE FROM page_views v USING pages p WHERE v.page_id = p.id AND v.${RETENTION_PREDICATE.trim()}`,
    [defaultRetentionDays],
  )
  const { rowCount: clickCount } = await executor.query(
    `DELETE FROM page_clicks c USING pages p WHERE c.page_id = p.id AND c.${RETENTION_PREDICATE.trim()}`,
    [defaultRetentionDays],
  )
  return rowCount + clickCount
}
