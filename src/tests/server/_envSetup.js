// Must be the FIRST import in any server test file.
// Sets PGDATABASE before server modules create the pg pool.
// Stays fully synchronous: a top-level await here would let sibling imports in
// the test file evaluate (and build the pool) before PGDATABASE is rewritten.
import 'dotenv/config'
import { resolveTestDatabase, workerDatabaseName } from './_databaseGuard.js'

const base = resolveTestDatabase(process.env)

if (!base.endsWith('_test')) {
  throw new Error(
    `Refusing to run server tests against '${base}'. ` +
    `Set PGDATABASE_TEST or use a database whose name ends in '_test'.`,
  )
}

// _workerDatabase.js (server config only) sets the marker once it has cloned
// this worker's database from the template. Without it, runs fall back to the
// single shared base database.
const testDb = process.env.GIGBUDDY_TEST_WORKER_DB
  ? workerDatabaseName(base, process.env.VITEST_POOL_ID)
  : base

process.env.PGDATABASE = testDb
// Mutation helpers require this marker and independently compare it with
// PostgreSQL's current_database(). Merely setting NODE_ENV=test is insufficient.
process.env.GIGBUDDY_TEST_DATABASE = testDb
// Parallel workers each hold a pool against one server (max_connections 100),
// so cap them well below the default 10 per pool.
process.env.PG_POOL_MAX = process.env.PG_POOL_MAX || '5'
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-not-secure'
process.env.NODE_ENV = 'test'
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@test.local'
process.env.INTEGRATION_SECRETS_KEYS = process.env.INTEGRATION_SECRETS_KEYS
  || JSON.stringify({ test: Buffer.alloc(32, 0x42).toString('base64') })
process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID = process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID || 'test'
