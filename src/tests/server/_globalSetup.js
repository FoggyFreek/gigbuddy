// Runs once in the main process, before any test worker is forked.
//
// Builds a schema-only template database, which each worker then clones with
// CREATE DATABASE ... TEMPLATE (a filesystem copy, ~O(bytes) not O(migrations)).
// Giving every worker its own database is what lets the server suite drop
// --no-file-parallelism: files no longer truncate each other's fixtures.
import 'dotenv/config'
import {
  resolveTestDatabase,
  templateDatabaseName,
  workerDatabasePattern,
} from './_databaseGuard.js'
import {
  withAdminClient,
  createDatabase,
  dropDatabase,
  dropDatabasesConcurrently,
  databaseExists,
  listDatabases,
  relaxDurability,
} from './_databaseAdmin.js'

const base = resolveTestDatabase(process.env)
const template = templateDatabaseName(base)

// Migrations are additive and runMigrations() is incremental, so an existing
// template is topped up rather than rebuilt — that is the whole point of
// keeping it between runs. Editing an already-applied migration in place needs
// GIGBUDDY_TEST_FRESH_TEMPLATE=1 (the shared-database setup had the same caveat).
async function buildTemplate() {
  await withAdminClient(async (client) => {
    if (process.env.GIGBUDDY_TEST_FRESH_TEMPLATE === '1') {
      await dropDatabase(client, template)
    }
    if (!(await databaseExists(client, template))) {
      await createDatabase(client, template)
    }
    await relaxDurability(client, template)
  })

  // server/db/index.js builds its pool from the ambient PG* env at import time,
  // so point the env at the template before the dynamic import, then restore it
  // — workers inherit this process's env and must start from the base name.
  const previousDatabase = process.env.PGDATABASE
  const previousMarker = process.env.GIGBUDDY_TEST_DATABASE
  const previousNodeEnv = process.env.NODE_ENV
  process.env.PGDATABASE = template
  process.env.GIGBUDDY_TEST_DATABASE = template
  process.env.NODE_ENV = 'test'
  try {
    const { pool, runMigrations } = await import('./_db.js')
    await runMigrations()
    // The clone is refused while any backend still has the template as its
    // current database, so this disconnect is load-bearing.
    await pool.end()
  } finally {
    process.env.PGDATABASE = previousDatabase
    process.env.GIGBUDDY_TEST_DATABASE = previousMarker
    process.env.NODE_ENV = previousNodeEnv
  }
}

// Clones left by a previous run predate any migrations added since, and workers
// only create a database that is missing. Dropping them here is what makes
// "clone on first use" correct.
async function dropWorkerDatabases() {
  const stale = await withAdminClient((client) =>
    listDatabases(client, workerDatabasePattern(base)))
  if (stale.length === 0) return 0
  await dropDatabasesConcurrently(stale)
  return stale.length
}

export async function setup() {
  if (!base.endsWith('_test')) {
    throw new Error(`Refusing to build a test template from '${base}': name must end in '_test'`)
  }
  const startedAt = Date.now()
  await dropWorkerDatabases()
  await buildTemplate()
  console.log(`[db] template ${template} ready in ${Date.now() - startedAt}ms`)
}

export async function teardown() {
  const startedAt = Date.now()
  await dropWorkerDatabases()
  console.log(`[db] worker databases dropped in ${Date.now() - startedAt}ms`)
}
