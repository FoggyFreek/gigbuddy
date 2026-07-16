const TEST_DATABASE_ENV = 'GIGBUDDY_TEST_DATABASE'

export function resolveTestDatabase(env = process.env) {
  const explicitTestDb = env.PGDATABASE_TEST?.trim()
  if (explicitTestDb) return explicitTestDb

  const configuredDb = env.PGDATABASE?.trim() || 'gigbuddy'
  return configuredDb.endsWith('_test') ? configuredDb : `${configuredDb}_test`
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
