// Minimal forward-only SQL migration runner. Files in server/migrations/ run
// in alphabetical order (numeric prefixes must stay zero-padded + monotonic);
// applied names are tracked in schema_migrations.
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import 'dotenv/config'
import { createPool } from './db.js'

const MIGRATIONS_DIR = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'migrations')

export async function runMigrations(pool) {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
  )
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  const { rows } = await pool.query('SELECT name FROM schema_migrations')
  const applied = new Set(rows.map((r) => r.name))

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      console.log(`applied ${file}`)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
}

// Run directly: `npm run migrate`
if (process.argv[1] === url.fileURLToPath(import.meta.url)) {
  const pool = createPool()
  runMigrations(pool)
    .then(() => pool.end())
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
      return pool.end()
    })
}
