// SQL for visit statistics. Reads are aggregate-only by design: the editor
// UI shows counts per dimension, never individual view rows.

export async function insertView(executor, pageId, { device, source, country, visitorHash }) {
  await executor.query(
    `INSERT INTO page_views (page_id, device, source, country, visitor_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [pageId, device, source, country, visitorHash],
  )
}

async function countBy(executor, pageId, since, column, limit) {
  const { rows } = await executor.query(
    `SELECT ${column} AS key, COUNT(*)::int AS views
       FROM page_views
      WHERE page_id = $1 AND occurred_at >= $2
      GROUP BY ${column}
      ORDER BY views DESC, key
      LIMIT $3`,
    [pageId, since, limit],
  )
  return rows
}

export async function aggregateStats(executor, pageId, since) {
  const [{ rows: totals }, byDevice, bySource, byCountry, { rows: byDay }] = await Promise.all([
    executor.query(
      `SELECT COUNT(*)::int AS views,
              COUNT(DISTINCT (visitor_hash, occurred_at::date))::int AS unique_visits
         FROM page_views
        WHERE page_id = $1 AND occurred_at >= $2`,
      [pageId, since],
    ),
    countBy(executor, pageId, since, 'device', 10),
    countBy(executor, pageId, since, 'source', 12),
    countBy(executor, pageId, since, 'country', 12),
    executor.query(
      `SELECT occurred_at::date AS day, COUNT(*)::int AS views
         FROM page_views
        WHERE page_id = $1 AND occurred_at >= $2
        GROUP BY day
        ORDER BY day`,
      [pageId, since],
    ),
  ])
  return {
    totalViews: totals[0].views,
    uniqueVisits: totals[0].unique_visits,
    byDevice,
    bySource,
    byCountry,
    byDay: byDay.map((r) => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day,
      views: r.views,
    })),
  }
}

// Retention: raw view events older than the configured window are deleted.
export async function purgeOldViews(executor, retentionDays) {
  const { rowCount } = await executor.query(
    `DELETE FROM page_views WHERE occurred_at < NOW() - make_interval(days => $1)`,
    [retentionDays],
  )
  return rowCount
}
