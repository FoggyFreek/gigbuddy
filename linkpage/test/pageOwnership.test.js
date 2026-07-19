import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../server/app.js'
import { signPayload } from '../server/tokens.js'

// A faithful in-memory model of the `pages` table for the queries the editor
// session route issues — crucially reproducing upsertMainPage's guarded
// ON CONFLICT semantics (update only when the existing row is the SAME tenant
// and a main page; otherwise RETURNING is empty).
function makeFakePool(pages) {
  let nextId = Math.max(0, ...pages.map((p) => p.id)) + 1
  return {
    rows: pages,
    query: async (sql, params = []) => {
      if (sql.includes('INSERT INTO pages') && sql.includes("VALUES ($1, $2, 'main')")) {
        const [slug, tenantId] = params
        const existing = pages.find((p) => p.slug === slug)
        if (!existing) {
          const row = {
            id: nextId++,
            slug,
            gigbuddy_tenant_id: tenantId,
            page_type: 'main',
            release: null,
            draft_layout: { sections: [] },
            published_layout: null,
            content: {},
            content_synced_at: null,
            published_at: null,
            created_at: new Date(),
          }
          pages.push(row)
          return { rows: [row] }
        }
        // Guard: only the same tenant's main page is returned/updated.
        if (existing.gigbuddy_tenant_id === tenantId && existing.page_type === 'main') {
          existing.updated_at = new Date()
          return { rows: [existing] }
        }
        return { rows: [] }
      }
      if (sql.includes('SET content =')) {
        const row = pages.find((p) => p.id === params[0])
        if (row) {
          row.content = JSON.parse(params[1])
          row.content_synced_at = new Date()
        }
        return { rows: row ? [row] : [] }
      }
      if (sql.includes('FROM pages') && sql.includes('WHERE gigbuddy_tenant_id')) {
        return { rows: pages.filter((p) => p.gigbuddy_tenant_id === params[0]) }
      }
      return { rows: [], rowCount: 0 }
    },
  }
}

const SECRET = 'ownership-test-secret'
const exp = () => Math.floor(Date.now() / 1000) + 600

beforeAll(() => {
  process.env.GIGBUDDY_SYNC_SECRET = SECRET
  process.env.GIGBUDDY_URL = 'http://stub'
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ band: { slug: 'x', name: 'X', socials: {} }, songs: [], products: [], gigs: [], links: [] }),
  })
})

afterAll(() => {
  delete process.env.GIGBUDDY_SYNC_SECRET
})

let pages
beforeEach(() => {
  pages = []
})

function openSession(app, slug, tenantId) {
  return request(app)
    .post('/api/editor/session')
    .send({ token: signPayload({ t: 'handoff', slug, tenantId, exp: exp() }) })
}

describe('main-page upsert ownership', () => {
  it('creates the main page on first open and reuses it on re-open (same tenant)', async () => {
    const pool = makeFakePool(pages)
    const app = createApp(pool)

    const first = await openSession(app, 'foo-bar', 42)
    expect(first.status).toBe(200)
    expect(first.body.page.pageType).toBe('main')
    const id = first.body.page.id

    const again = await openSession(app, 'foo-bar', 42)
    expect(again.status).toBe(200)
    expect(again.body.page.id).toBe(id)
    expect(pages.filter((p) => p.slug === 'foo-bar')).toHaveLength(1)
  })

  it('refuses to hijack another tenant’s release row that collides with a main slug', async () => {
    // Tenant 1 (band "foo") owns release page "foo-bar".
    pages.push({
      id: 1,
      slug: 'foo-bar',
      gigbuddy_tenant_id: 1,
      page_type: 'release',
      release: { songId: 9, title: 'Bar', artist: null },
      draft_layout: { sections: [{ id: 's', widgets: [] }] },
      published_layout: { sections: [] },
      content: { band: { name: 'Foo' } },
      content_synced_at: new Date(),
      published_at: new Date(),
      created_at: new Date(),
    })
    const pool = makeFakePool(pages)
    const app = createApp(pool)

    // Tenant 2 (band "foo-bar") opens its editor — the slug collides.
    const res = await openSession(app, 'foo-bar', 2)
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('slug_conflict')

    // The existing row is untouched: still tenant 1, still a release page,
    // still its own content — no ownership transfer, no corruption.
    const row = pages.find((p) => p.slug === 'foo-bar')
    expect(row.gigbuddy_tenant_id).toBe(1)
    expect(row.page_type).toBe('release')
    expect(row.content).toEqual({ band: { name: 'Foo' } })
  })

  it('refuses when the slug is another tenant’s main page', async () => {
    pages.push({
      id: 1,
      slug: 'foo',
      gigbuddy_tenant_id: 1,
      page_type: 'main',
      release: null,
      draft_layout: { sections: [] },
      published_layout: { sections: [] },
      content: {},
      content_synced_at: new Date(),
      published_at: new Date(),
      created_at: new Date(),
    })
    const pool = makeFakePool(pages)
    const app = createApp(pool)

    const res = await openSession(app, 'foo', 2)
    expect(res.status).toBe(409)
    expect(pages.find((p) => p.slug === 'foo').gigbuddy_tenant_id).toBe(1)
  })
})
