import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../server/app.js'

beforeAll(() => {
  process.env.GIGBUDDY_SYNC_SECRET = 'health-test'
})

describe('health endpoint', () => {
  it('responds 200 without touching the database (container liveness probe)', async () => {
    // A pool that would throw if queried — proves the probe does no DB work.
    const pool = {
      query: () => {
        throw new Error('health must not query the database')
      },
    }
    const res = await request(createApp(pool)).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})
