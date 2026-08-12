import 'dotenv/config'
import pool from '../../../db/index.js'
import { testStorageConnection } from '../storageConnectionService.js'

try {
  const result = await testStorageConnection()
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.connected || !result.operationsVerified) process.exitCode = 1
} finally {
  await pool.end()
}
