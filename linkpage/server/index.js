// Production entry point: API + built SPA assets in one process, mirroring
// the gigbuddy deployment shape. Run `npm run migrate` before first start.
import path from 'node:path'
import url from 'node:url'
import fs from 'node:fs'
import express from 'express'
import 'dotenv/config'
import { createPool } from './db.js'
import { createApp } from './app.js'
import { purgeOldViews } from './statsRepo.js'

const pool = createPool()
const app = createApp(pool)

const distDir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  // SPA fallback for /:slug, /edit and /privacy.
  app.get('/*splat', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// Statistics retention (PRIVACY.md): purge raw view events past the window,
// on boot and then daily.
const retentionDays = Number(process.env.STATS_RETENTION_DAYS) || 396
async function purge() {
  try {
    const deleted = await purgeOldViews(pool, retentionDays)
    if (deleted > 0) console.log(`purged ${deleted} view events older than ${retentionDays} days`)
  } catch (err) {
    console.error('stats purge failed:', err.message)
  }
}
purge()
setInterval(purge, 24 * 60 * 60 * 1000).unref()

const port = Number(process.env.LINKPAGE_PORT) || 3010
app.listen(port, () => {
  console.log(`linkpage listening on :${port}`)
})
