import express from 'express'
import session from 'express-session'
import routes from '../../../server/routes/index.js'

// Test app: real routes + middleware, but bypassing OIDC, persistent session
// store, CORS, static SPA, etc. Identity is supplied per-request via
// `x-test-user-id` and `x-test-tenant-id` headers; CSRF is short-circuited by
// copying the stored token onto the request.
export function createTestApp() {
  const app = express()
  app.use(express.json())
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { sameSite: 'lax' },
    }),
  )

  app.use((req, _res, next) => {
    const userHeader = req.get('x-test-user-id')
    const tenantHeader = req.get('x-test-tenant-id')
    if (userHeader === 'null') {
      req.session.userId = null
    } else if (userHeader !== undefined) {
      req.session.userId = Number(userHeader)
    }
    if (tenantHeader === 'null') {
      req.session.activeTenantId = null
    } else if (tenantHeader !== undefined) {
      req.session.activeTenantId = Number(tenantHeader)
    }

    if (req.session.userId) {
      if (!req.session.csrfToken) req.session.csrfToken = 'test-csrf-token'
      req.headers['x-csrf-token'] = req.session.csrfToken
    }
    next()
  })

  app.use('/api', routes)

  app.use((err, _req, res, _next) => {
    if (process.env.DEBUG_TEST_ERRORS) console.error(err)
    res.status(err.status || 500).json({ error: err.message || 'Internal error' })
  })

  return app
}
