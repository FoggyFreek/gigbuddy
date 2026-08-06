import pg from 'pg'
import 'dotenv/config'
import { logger } from '../utils/logger.js'

const { Pool, types } = pg

// Return DATE (OID 1082) as the raw 'YYYY-MM-DD' string rather than a JS Date,
// so timezone shifts can't move a stored calendar date to an adjacent day on
// the way back to the client.
types.setTypeParser(1082, (val) => val)

// pg reads PGHOST, PGDATABASE, PGUSER, PGPASSWORD, PGPORT automatically.
// PG_POOL_MAX caps connections per process (pg's own default is 10); the
// parallel test workers set it so N pools stay under the server's max_connections.
const poolMax = Number.parseInt(process.env.PG_POOL_MAX ?? '', 10)
const pool = new Pool(poolMax > 0 ? { max: poolMax } : {})

pool.on('error', (err) => {
  logger.error('postgres.unexpected_client_error', { err })
})

export default pool
