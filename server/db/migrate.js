import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pool from './index.js'
import { logger } from '../utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, 'migrations')

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      run_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM migrations WHERE filename = $1',
      [file]
    )
    if (rows.length > 0) continue

    const sql = await readFile(join(migrationsDir, file), 'utf8')
    await pool.query(sql)
    await pool.query('INSERT INTO migrations (filename) VALUES ($1)', [file])
    logger.info('migration.applied', { filename: file })
  }

  await pool.end()
  logger.info('migration.complete', {})
}

try {
  await migrate()
} catch (err) {
  logger.error('migration.failed', { err })
  process.exit(1)
}
