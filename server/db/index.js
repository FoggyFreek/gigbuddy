import pg from 'pg'
import 'dotenv/config'

const { Pool, types } = pg

// Return DATE (OID 1082) as the raw 'YYYY-MM-DD' string rather than a JS Date,
// so timezone shifts can't move a stored calendar date to an adjacent day on
// the way back to the client.
types.setTypeParser(1082, (val) => val)

// pg reads PGHOST, PGDATABASE, PGUSER, PGPASSWORD, PGPORT automatically
const pool = new Pool()

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error', err)
})

export default pool
