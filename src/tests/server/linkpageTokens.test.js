import './_envSetup.js'
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isValidSyncBearer } from '../../../server/promotion/linkpage/linkpageTokens.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('LinkBuddy integration bearer', () => {
  it('accepts the configured secret with normal or padded delimiters', () => {
    vi.stubEnv('LINKPAGE_SECRET', 'test-linkpage-secret')

    expect(isValidSyncBearer('Bearer test-linkpage-secret')).toBe(true)
    expect(isValidSyncBearer('Bearer    test-linkpage-secret')).toBe(true)
    expect(isValidSyncBearer('Bearer\ttest-linkpage-secret')).toBe(true)
  })

  it('rejects malformed credentials without pathological backtracking', () => {
    vi.stubEnv('LINKPAGE_SECRET', 'test-linkpage-secret')
    const started = Date.now()

    for (const value of [
      undefined,
      'Bearer',
      'Bearer   ',
      'Basic test-linkpage-secret',
      'Bearer nope',
      `Bearer${' '.repeat(50_000)}\n`,
    ]) {
      expect(isValidSyncBearer(value)).toBe(false)
    }
    expect(Date.now() - started).toBeLessThan(100)
  })
})
