// One-shot retention purge (`npm run stats:purge`) for deployments that
// prefer an external scheduler over the in-process daily purge.
import 'dotenv/config'
import { createPool } from './db.js'
import { purgeOldViews } from './statsRepo.js'

const pool = createPool()
const retentionDays = Number(process.env.STATS_RETENTION_DAYS) || 396

purgeOldViews(pool, retentionDays)
  .then((deleted) => {
    console.log(`purged ${deleted} view events older than ${retentionDays} days`)
    return pool.end()
  })
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
    return pool.end()
  })
