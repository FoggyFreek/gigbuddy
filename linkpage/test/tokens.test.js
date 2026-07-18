import { describe, it, expect, beforeAll } from 'vitest'
import { signPayload, verifyPayload } from '../server/tokens.js'

beforeAll(() => {
  process.env.GIGBUDDY_SYNC_SECRET = 'test-secret'
})

describe('tokens', () => {
  it('round-trips a payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 60
    const token = signPayload({ t: 'handoff', slug: 'woods', exp })
    expect(verifyPayload(token)).toMatchObject({ t: 'handoff', slug: 'woods' })
  })

  it('rejects tampering and expiry', () => {
    const exp = Math.floor(Date.now() / 1000) + 60
    const token = signPayload({ t: 'session', slug: 'woods', exp })
    const [body, mac] = token.split('.')
    const forgedBody = Buffer.from(JSON.stringify({ t: 'session', slug: 'other', exp })).toString('base64url')
    expect(verifyPayload(`${forgedBody}.${mac}`)).toBeNull()
    expect(verifyPayload(`${body}.AAAA`)).toBeNull()
    expect(verifyPayload('garbage')).toBeNull()
    expect(verifyPayload(signPayload({ t: 'session', slug: 'woods', exp: 1 }))).toBeNull()
  })
})
