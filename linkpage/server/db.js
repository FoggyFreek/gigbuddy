// Dedicated Postgres pool for the linkpage app. Statistics and page layouts
// live in their own database — this app never connects to gigbuddy's.
import pg from 'pg'

export function createPool() {
  if (process.env.LINKPAGE_DATABASE_URL) {
    return new pg.Pool({ connectionString: process.env.LINKPAGE_DATABASE_URL })
  }
  // Host/user/password/port come from the standard PG* env vars via the driver;
  // only the database name is forced to the linkpage-specific one.
  return new pg.Pool({ database: process.env.LINKPAGE_PGDATABASE || 'gigbuddy_linkpage' })
}
