import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pool from './db/index.js'
import routes from './routes/index.js'
import { initOidc } from './oidc.js'
import { securityHeaders } from './middleware/securityHeaders.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable must be set')
}

const app = express()
const PORT = process.env.SERVER_PORT || 3002

app.set('trust proxy', 1)

app.use(securityHeaders())

const PgSession = connectPgSimple(session)

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
  exposedHeaders: ['X-CSRF-Token'],
}))
app.use(express.json())
app.use(
  session({
    store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
)

app.use('/api', routes)

app.use(express.static(join(__dirname, '../dist')))
app.use((_req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'))
})

app.use((err, _req, res, _next) => {
  console.error(err)
  const status = err.status || 500
  // Only surface the specific message for client errors (4xx); for server
  // errors expose nothing beyond a generic string to avoid leaking internals
  // such as DB constraint names, file paths, or stack traces (OWASP A02).
  const message = status < 500 ? (err.message || 'Bad request') : 'Internal error'
  res.status(status).json({ error: message })
})

await initOidc()

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

export default app
