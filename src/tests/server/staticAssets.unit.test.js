// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { staticAssets } from '../../../server/app/staticAssets.js'
import { securityHeaders } from '../../../server/middleware/securityHeaders.js'

let distDir
let app

beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), 'gigbuddy-dist-'))
  mkdirSync(join(distDir, 'icons', 'socials'), { recursive: true })
  mkdirSync(join(distDir, 'assets'), { recursive: true })
  writeFileSync(join(distDir, 'icons', 'socials', 'facebook.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(distDir, 'icons', 'gb_light_128.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>app</title>')

  app = express()
  app.use(securityHeaders())
  app.use(staticAssets(distDir))
})

afterAll(() => {
  rmSync(distDir, { recursive: true, force: true })
})

describe('static asset serving', () => {
  // Outreach social icons are embedded in email HTML that renders in a
  // sandboxed (opaque-origin) preview iframe and in third-party mail clients,
  // so the global CORP: same-origin would block them.
  it('serves social icons with Cross-Origin-Resource-Policy: cross-origin', async () => {
    const res = await request(app).get('/icons/socials/facebook.png').expect(200)
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
  })

  it('keeps the rest of dist on the default same-origin policy', async () => {
    const script = await request(app).get('/assets/app.js').expect(200)
    expect(script.headers['cross-origin-resource-policy']).toBe('same-origin')

    const icon = await request(app).get('/icons/gb_light_128.png').expect(200)
    expect(icon.headers['cross-origin-resource-policy']).toBe('same-origin')

    const index = await request(app).get('/index.html').expect(200)
    expect(index.headers['cross-origin-resource-policy']).toBe('same-origin')
  })

  it('does not relax the policy for a missing social icon', async () => {
    await request(app).get('/icons/socials/nope.png').expect(404)
  })
})
