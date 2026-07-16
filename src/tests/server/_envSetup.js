// Must be the FIRST import in any server test file.
// Sets PGDATABASE before server modules create the pg pool.
import 'dotenv/config'
import { resolveTestDatabase } from './_databaseGuard.js'

const testDb = resolveTestDatabase(process.env)

if (!testDb.endsWith('_test')) {
  throw new Error(
    `Refusing to run server tests against '${testDb}'. ` +
    `Set PGDATABASE_TEST or use a database whose name ends in '_test'.`,
  )
}

process.env.PGDATABASE = testDb
// Mutation helpers require this marker and independently compare it with
// PostgreSQL's current_database(). Merely setting NODE_ENV=test is insufficient.
process.env.GIGBUDDY_TEST_DATABASE = testDb
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-not-secure'
process.env.NODE_ENV = 'test'
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@test.local'
process.env.INTEGRATION_SECRETS_KEYS = process.env.INTEGRATION_SECRETS_KEYS
  || JSON.stringify({ test: Buffer.alloc(32, 0x42).toString('base64') })
process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID = process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID || 'test'
