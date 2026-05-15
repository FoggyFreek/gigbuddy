// @vitest-environment node
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { describe, it, expect, vi, afterEach } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import rateLimit from 'express-rate-limit'
import { sanitizeFilename } from '../../server/utils/sanitizeFilename.js'
import { verifyDocumentContent } from '../../server/utils/verifyFileContent.js'
import { auditLog } from '../../server/utils/auditLog.js'

// ---------------------------------------------------------------------------
// sanitizeFilename (A05 — header injection prevention)
// ---------------------------------------------------------------------------
describe('sanitizeFilename', () => {
  it('passes through a normal filename unchanged', () => {
    expect(sanitizeFilename('invoice.pdf')).toBe('invoice.pdf')
  })

  it('strips carriage-return and linefeed (CRLF injection)', () => {
    expect(sanitizeFilename('evil\r\nSet-Cookie: x=1')).not.toMatch(/[\r\n]/)
  })

  it('strips double-quote that would break the Content-Disposition value', () => {
    expect(sanitizeFilename('fi"le.pdf')).not.toContain('"')
  })

  it('strips backslash', () => {
    expect(sanitizeFilename('path\\file.pdf')).not.toContain('\\')
  })

  it('strips null byte', () => {
    expect(sanitizeFilename('file\x00.pdf')).not.toContain('\x00')
  })

  it('strips all C0 control characters', () => {
    // Build a string with every char from 0x01–0x1f
    const controls = Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).join('')
    const result = sanitizeFilename(`a${controls}b`)
    expect([...result].some((ch) => ch.charCodeAt(0) <= 0x1f)).toBe(false)
  })

  it('returns "download" for an empty string', () => {
    expect(sanitizeFilename('')).toBe('download')
  })

  it('returns "download" for a whitespace-only string', () => {
    expect(sanitizeFilename('   ')).toBe('download')
  })

  it('returns "download" for non-string input', () => {
    expect(sanitizeFilename(null)).toBe('download')
    expect(sanitizeFilename(undefined)).toBe('download')
    expect(sanitizeFilename(42)).toBe('download')
  })

  it('truncates filenames longer than 255 characters', () => {
    const long = 'a'.repeat(300)
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(255)
  })

  it('preserves unicode characters that are valid in filenames', () => {
    expect(sanitizeFilename('ünïcödé.pdf')).toBe('ünïcödé.pdf')
  })
})

// ---------------------------------------------------------------------------
// verifyDocumentContent (A06 — magic-byte validation)
// ---------------------------------------------------------------------------
describe('verifyDocumentContent', () => {
  function zipWithEntries(entries) {
    return Buffer.concat(entries.map((entry) => {
      const name = Buffer.from(entry, 'utf8')
      const content = Buffer.from('<xml/>')
      const header = Buffer.alloc(30)
      header.writeUInt32LE(0x04034b50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(0, 6)
      header.writeUInt16LE(0, 8)
      header.writeUInt32LE(0, 14)
      header.writeUInt32LE(content.length, 18)
      header.writeUInt32LE(content.length, 22)
      header.writeUInt16LE(name.length, 26)
      header.writeUInt16LE(0, 28)
      return Buffer.concat([header, name, content])
    }))
  }

  // --- PDF ---
  it('accepts a buffer starting with %PDF magic bytes', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    expect(verifyDocumentContent(buf, 'application/pdf')).toBe(true)
  })

  it('rejects HTML content declared as PDF', () => {
    const buf = Buffer.from('<html><body>not a pdf</body></html>')
    expect(verifyDocumentContent(buf, 'application/pdf')).toBe(false)
  })

  it('rejects an empty buffer for PDF', () => {
    expect(verifyDocumentContent(Buffer.alloc(0), 'application/pdf')).toBe(false)
  })

  // --- Legacy Excel (.xls) and Word (.doc) — OLE2 ---
  it('accepts OLE2 magic bytes for application/vnd.ms-excel', () => {
    const buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(verifyDocumentContent(buf, 'application/vnd.ms-excel')).toBe(true)
  })

  it('rejects non-OLE2 content declared as application/vnd.ms-excel', () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46]) // PDF bytes
    expect(verifyDocumentContent(buf, 'application/vnd.ms-excel')).toBe(false)
  })

  it('accepts OLE2 magic bytes for application/msword', () => {
    const buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(verifyDocumentContent(buf, 'application/msword')).toBe(true)
  })

  // --- OOXML (.xlsx, .docx) — ZIP container with Office entries ---
  it('accepts xlsx when the ZIP contains workbook entries', () => {
    const buf = zipWithEntries(['[Content_Types].xml', 'xl/workbook.xml'])
    expect(
      verifyDocumentContent(
        buf,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(true)
  })

  it('rejects an empty ZIP declared as xlsx', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00])
    expect(
      verifyDocumentContent(
        buf,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(false)
  })

  it('rejects a generic ZIP with no xlsx workbook entry', () => {
    const buf = zipWithEntries(['[Content_Types].xml', 'not-office.txt'])
    expect(
      verifyDocumentContent(
        buf,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(false)
  })

  it('rejects OLE2 bytes declared as xlsx (wrong Office format era)', () => {
    const buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0])
    expect(
      verifyDocumentContent(
        buf,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(false)
  })

  it('accepts docx when the ZIP contains document entries', () => {
    const buf = zipWithEntries(['[Content_Types].xml', 'word/document.xml'])
    expect(
      verifyDocumentContent(
        buf,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(true)
  })

  // --- text/plain ---
  it('accepts ASCII text content for text/plain', () => {
    const buf = Buffer.from('Hello, this is plain text.')
    expect(verifyDocumentContent(buf, 'text/plain')).toBe(true)
  })

  it('accepts UTF-8 text content for text/plain', () => {
    const buf = Buffer.from('Héllo Wörld – band setlist', 'utf8')
    expect(verifyDocumentContent(buf, 'text/plain')).toBe(true)
  })

  it('rejects binary content (null bytes) declared as text/plain', () => {
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6c, 0x6f]) // "Hel\0lo"
    expect(verifyDocumentContent(buf, 'text/plain')).toBe(false)
  })

  // --- Unknown MIME type ---
  it('returns false for an unknown MIME type', () => {
    const buf = Buffer.from('anything')
    expect(verifyDocumentContent(buf, 'application/x-unknown')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// auditLog (A09 — structured logging)
// ---------------------------------------------------------------------------
describe('auditLog', () => {
  afterEach(() => vi.restoreAllMocks())

  function captureAuditEntries(fn) {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    fn()
    return logSpy.mock.calls.flatMap(([line]) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
  }

  it('writes a JSON line with the expected shape', () => {
    const fakeReq = { session: { userId: 7 }, tenantId: 3, ip: '1.2.3.4' }
    const entries = captureAuditEntries(() => auditLog(fakeReq, 'test.action'))

    expect(entries).toHaveLength(1)
    const e = entries[0]
    expect(e.action).toBe('test.action')
    expect(e.userId).toBe(7)
    expect(e.tenantId).toBe(3)
    expect(e.ip).toBe('1.2.3.4')
    expect(e.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('merges extra fields and they override defaults', () => {
    // Simulates the logout case where session is destroyed before logging
    const fakeReq = { session: undefined, tenantId: null, ip: '5.6.7.8' }
    const entries = captureAuditEntries(() =>
      auditLog(fakeReq, 'auth.logout', { userId: 42 }),
    )

    expect(entries[0].userId).toBe(42)
    expect(entries[0].action).toBe('auth.logout')
  })

  it('handles a null req gracefully', () => {
    const entries = captureAuditEntries(() =>
      auditLog(null, 'auth.login', { userId: 1, email: 'a@b.com' }),
    )

    expect(entries).toHaveLength(1)
    expect(entries[0].userId).toBe(1)
    expect(entries[0].ip).toBeNull()
  })

  it('includes arbitrary extra fields', () => {
    const fakeReq = { session: { userId: 1 }, tenantId: 2, ip: '0.0.0.0' }
    const entries = captureAuditEntries(() =>
      auditLog(fakeReq, 'invite.create', { inviteId: 99, role: 'member' }),
    )

    expect(entries[0].inviteId).toBe(99)
    expect(entries[0].role).toBe('member')
  })
})

// ---------------------------------------------------------------------------
// Global error handler — 5xx must not leak internal messages (A02/A10)
// ---------------------------------------------------------------------------
describe('error handler — message suppression on 5xx', () => {
  it('returns "Internal error" and NOT the actual message for 5xx', async () => {
    const a = express()
    a.get('/boom', (_req, _res, next) => {
      const err = new Error('secret: users_pkey constraint violation')
      next(err)
    })
    a.use((err, _req, res, _next) => {
      const status = err.status || 500
      const message = status < 500 ? (err.message || 'Bad request') : 'Internal error'
      res.status(status).json({ error: message })
    })

    const res = await supertest(a).get('/boom').expect(500)
    expect(res.body.error).toBe('Internal error')
    expect(res.body.error).not.toContain('users_pkey')
    expect(res.body.error).not.toContain('secret')
  })

  it('returns the specific message for 4xx errors', async () => {
    const a = express()
    a.get('/missing', (_req, _res, next) => {
      const err = new Error('Membership not found')
      err.status = 404
      next(err)
    })
    a.use((err, _req, res, _next) => {
      const status = err.status || 500
      const message = status < 500 ? (err.message || 'Bad request') : 'Internal error'
      res.status(status).json({ error: message })
    })

    const res = await supertest(a).get('/missing').expect(404)
    expect(res.body.error).toBe('Membership not found')
  })
})

// ---------------------------------------------------------------------------
// Rate limiting (A02/A07)
// ---------------------------------------------------------------------------
describe('rate limiting', () => {
  function makeLimitedApp(max) {
    const a = express()
    a.use(
      rateLimit({
        windowMs: 60_000,
        max,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        // Match the production message format so clients get a JSON error body
        message: { error: 'Too many requests, please try again later' },
      }),
    )
    a.get('/ping', (_req, res) => res.json({ ok: true }))
    return a
  }

  it('allows requests up to the configured limit', async () => {
    const a = makeLimitedApp(3)
    const r = supertest(a)
    await r.get('/ping').expect(200)
    await r.get('/ping').expect(200)
    await r.get('/ping').expect(200)
  })

  it('returns 429 with a JSON error body once the limit is exceeded', async () => {
    const a = makeLimitedApp(2)
    const r = supertest(a)
    await r.get('/ping').expect(200)
    await r.get('/ping').expect(200)
    const res = await r.get('/ping').expect(429)
    // Production limiters send { error: '...' }
    expect(res.body).toHaveProperty('error')
    // Retry-After tells the client when to try again
    expect(res.headers).toHaveProperty('retry-after')
  })

  it('includes the draft-8 RateLimit combined header on success', async () => {
    // RFC draft-8 merges limit+remaining into a single "ratelimit" header
    const a = makeLimitedApp(10)
    const res = await supertest(a).get('/ping').expect(200)
    expect(res.headers).toHaveProperty('ratelimit')
    expect(res.headers).toHaveProperty('ratelimit-policy')
  })

  it('does not apply the tight auth limiter to /auth/me', async () => {
    const oldEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    vi.resetModules()
    const { default: routes } = await import('../../server/routes/index.js')
    process.env.NODE_ENV = oldEnv

    const a = express()
    a.use('/api', routes)

    for (let i = 0; i < 35; i++) {
      const res = await supertest(a).get('/api/auth/me')
      expect(res.status).toBe(401)
    }
  })
})
