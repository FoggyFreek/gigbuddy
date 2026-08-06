const TEST_DATABASE_ENV = 'GIGBUDDY_TEST_DATABASE'

export function resolveTestDatabase(env = process.env) {
  const explicitTestDb = env.PGDATABASE_TEST?.trim()
  if (explicitTestDb) return explicitTestDb

  const configuredDb = env.PGDATABASE?.trim() || 'gigbuddy'
  return configuredDb.endsWith('_test') ? configuredDb : `${configuredDb}_test`
}

// Strip the `_test` suffix and any worker marker so the name-derivation helpers
// below are idempotent: feeding `gigbuddy_w3_test` back in must not produce
// `gigbuddy_w3_w3_test`. Test modules re-evaluate under vitest's per-file
// isolation, so they do get fed their own output.
function databaseRoot(base) {
  return base.replace(/_test$/, '').replace(/_w\d+$/, '')
}

// The schema-only database that per-worker databases are cloned from. Built
// once per suite run by _globalSetup.js and reused across runs.
export function templateDatabaseName(base) {
  return `${databaseRoot(base)}_template_test`
}

// Per-worker clone. Keeps the `_test` suffix so assertTestDatabase's naming
// invariant holds unchanged. Without a pool id (a plain single-database run)
// the base name passes through.
export function workerDatabaseName(base, poolId) {
  if (!poolId) return base
  return `${databaseRoot(base)}_w${poolId}_test`
}

// SQL LIKE pattern matching every per-worker clone, for stale-database cleanup.
export function workerDatabasePattern(base) {
  return `${databaseRoot(base)}\\_w%\\_test`
}

// Defense in depth for every test helper that mutates PostgreSQL. This checks
// the bootstrap marker as well as PostgreSQL's actual connection target, so a
// missing/late _envSetup import cannot redirect destructive setup to PGDATABASE.
export async function assertTestDatabase(executor, env = process.env) {
  if (env.NODE_ENV !== 'test') {
    throw new Error('Refusing test database mutation: NODE_ENV is not test')
  }

  const expected = env[TEST_DATABASE_ENV]
  if (!expected) {
    throw new Error('Refusing test database mutation: test database bootstrap marker is missing')
  }
  if (!expected.endsWith('_test')) {
    throw new Error(
      `Refusing test database mutation: configured test database '${expected}' does not end in '_test'`,
    )
  }

  const { rows } = await executor.query('SELECT current_database() AS database')
  const actual = rows[0]?.database
  if (actual !== expected) {
    throw new Error(
      `Refusing test database mutation: connected to '${actual}', expected '${expected}'`,
    )
  }
}
