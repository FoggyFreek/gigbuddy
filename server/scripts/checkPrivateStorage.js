import 'dotenv/config'
import pool from '../db/index.js'
import { testPrivateStorageConnection } from '../services/storageMigrationService.js'

try {
  const result = await testPrivateStorageConnection()
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.connected || !result.operationsVerified) process.exitCode = 1
} finally {
  await pool.end()
}
