// Must be the FIRST import in any server test file.
// Sets PGDATABASE before server modules create the pg pool.
import 'dotenv/config'

const baseDb = process.env.PGDATABASE || 'gigbuddy'
const testDb = process.env.PGDATABASE_TEST || `${baseDb}_test`

if (!testDb.endsWith('_test')) {
  throw new Error(
    `Refusing to run server tests against '${testDb}'. ` +
    `Set PGDATABASE_TEST or use a database whose name ends in '_test'.`,
  )
}

process.env.PGDATABASE = testDb
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-not-secure'
process.env.NODE_ENV = 'test'
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@test.local'
