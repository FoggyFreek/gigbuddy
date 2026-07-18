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
    executor.query(
      `SELECT COUNT(*)::int AS clicks FROM page_clicks WHERE page_id = $1 AND occurred_at >= $2`,
      [pageId, since],
    ),
    countBy(executor, pageId, since, 'page_views', 'device', 10),
    countBy(executor, pageId, since, 'page_views', 'source', 12),
    countBy(executor, pageId, since, 'page_views', 'country', 12),
    countBy(executor, pageId, since, 'page_clicks', 'target', 15),
    countBy(executor, pageId, since, 'page_clicks', 'source', 12),
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

// Retention: raw view/click events older than the configured window are deleted.
export async function purgeOldViews(executor, retentionDays) {
  const { rowCount } = await executor.query(
    `DELETE FROM page_views WHERE occurred_at < NOW() - make_interval(days => $1)`,
    [retentionDays],
  )
  const { rowCount: clickCount } = await executor.query(
    `DELETE FROM page_clicks WHERE occurred_at < NOW() - make_interval(days => $1)`,
    [retentionDays],
  )
  return rowCount + clickCount
}
