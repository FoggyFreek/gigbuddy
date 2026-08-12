// CREATE/DROP DATABASE cannot run against the database being created or
// dropped, so these helpers connect to the `postgres` maintenance database
// rather than reusing server/db/index.js's pool.
import pg from 'pg'

const DUPLICATE_DATABASE = '42P04'
const OBJECT_IN_USE = '55006'

// Database names here are derived from env, never from a request, but a
// whitelist keeps an odd PGDATABASE from reaching CREATE DATABASE unquoted.
function quoteIdent(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Unsafe database identifier: ${name}`)
  }
  return `"${name}"`
}

export async function withAdminClient(fn) {
  const client = new pg.Client({ database: 'postgres' })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

export async function databaseExists(client, name) {
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
  return rows.length > 0
}

export async function listDatabases(client, likePattern) {
  const { rows } = await client.query(
    'SELECT datname FROM pg_database WHERE datname LIKE $1',
    [likePattern],
  )
  return rows.map((r) => r.datname)
}

// FORCE (PG 13+) terminates leftover backends so a leaked pool can't hang teardown.
export async function dropDatabase(client, name) {
  await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`)
}

// A worked-on database is far bigger than the clone it started as (dead tuples
// from ~2000 truncate/seed cycles), and dropping one is seconds of file
// deletion, not the ~50ms a fresh clone takes. Serially that dominated the gap
// between the last assertion and process exit, so fan out over one connection
// each — the work is disk-bound and the server parallelizes it well.
export async function dropDatabasesConcurrently(names) {
  await Promise.all(names.map((name) => withAdminClient((client) => dropDatabase(client, name))))
}

export async function createDatabase(client, name) {
  try {
    await client.query(`CREATE DATABASE ${quoteIdent(name)}`)
  } catch (err) {
    if (err.code !== DUPLICATE_DATABASE) throw err
  }
}

// Disposable databases have nothing to protect against a crash, and the commit
// fsync is the dominant cost once several workers commit concurrently against
// one server. Per-database, so the dev database keeps full durability.
// pg_db_role_setting is keyed by database OID and is NOT copied by a template
// clone, so every clone needs this applied to it directly.
export async function relaxDurability(client, name) {
  await client.query(`ALTER DATABASE ${quoteIdent(name)} SET synchronous_commit = off`)
}

// The template's data directory is copied at the filesystem level, so this
// costs O(bytes on disk) rather than O(migrations). PostgreSQL refuses the copy
// while any backend has the template as its current database (55006); the retry
// absorbs a straggler that is still disconnecting.
export async function createFromTemplate(client, name, template, { attempts = 10 } = {}) {
  const sql = `CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`
  for (let attempt = 1; ; attempt += 1) {
    try {
      await client.query(sql)
      return
    } catch (err) {
      if (err.code === DUPLICATE_DATABASE) return
      if (err.code !== OBJECT_IN_USE || attempt >= attempts) throw err
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
    }
  }
}
