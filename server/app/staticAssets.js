import express from 'express'
import { join } from 'node:path'

// Serves the built SPA. Social icons get their own mount first: they are
// embedded in outreach email HTML, which renders both in the sandboxed
// (opaque-origin) preview iframe and in third-party mail clients, so helmet's
// global CORP: same-origin blocks them. Mark those public email assets
// cross-origin — same relaxation the public outreach image route makes — and
// leave the rest of dist on the default lockdown.
export function staticAssets(distDir) {
  const router = express.Router()
  router.use(
    '/icons/socials',
    express.static(join(distDir, 'icons', 'socials'), {
      setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
    }),
  )
  router.use(express.static(distDir))
  return router
}
