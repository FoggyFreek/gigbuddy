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

const __dirname = dirname(fileURLToPath(import.meta.url))

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable must be set')
}

const app = express()
const PORT = process.env.SERVER_PORT || 3002

const PgSession = connectPgSimple(session)

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
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
  res.status(err.status || 500).json({ error: err.message || 'Internal error' })
})

await initOidc()

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

export default app
