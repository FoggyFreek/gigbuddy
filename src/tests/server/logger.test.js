// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '../../../server/utils/logger.js'
import { runWithStore } from '../../../server/utils/requestContextStore.js'

const originalLogLevel = process.env.LOG_LEVEL

function lastLine(spy) {
  return JSON.parse(spy.mock.calls.at(-1)[0])
}

describe('logger', () => {
  let logSpy
  let errorSpy

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
    if (originalLogLevel === undefined) delete process.env.LOG_LEVEL
    else process.env.LOG_LEVEL = originalLogLevel
  })

  it('gates by LOG_LEVEL, suppressing lower-priority levels', () => {
    process.env.LOG_LEVEL = 'warn'
    logger.info('x.event', {})
    expect(logSpy).not.toHaveBeenCalled()
    logger.warn('x.event', {})
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('falls back to info for an unrecognized LOG_LEVEL value', () => {
    process.env.LOG_LEVEL = 'bogus'
    logger.debug('x.event', {})
    expect(logSpy).not.toHaveBeenCalled()
    logger.info('x.event', {})
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('routes debug/info to console.log and warn/error to console.error', () => {
    process.env.LOG_LEVEL = 'debug'
    logger.debug('x.event', {})
    logger.info('x.event', {})
    expect(logSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy).not.toHaveBeenCalled()
    logger.warn('x.event', {})
    logger.error('x.event', {})
    expect(errorSpy).toHaveBeenCalledTimes(2)
  })

  it('redacts err to errorName/errorCode/errorStatus only, never message or stack', () => {
    const err = Object.assign(new Error('sensitive detail'), { code: 'AUTH_FAILED', statusCode: 401 })
    logger.error('x.event', { err })
    const line = lastLine(errorSpy)
    expect(line).toMatchObject({ errorName: 'Error', errorCode: 'AUTH_FAILED', errorStatus: 401 })
    expect(line).not.toHaveProperty('message')
    expect(line).not.toHaveProperty('stack')
    expect(JSON.stringify(line)).not.toContain('sensitive detail')
  })

  it('never includes message or stack even outside production (no env branching)', () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const err = new Error('do not leak me')
      logger.error('x.event', { err })
      const line = lastLine(errorSpy)
      expect(line).not.toHaveProperty('message')
      expect(line).not.toHaveProperty('stack')
      expect(JSON.stringify(line)).not.toContain('do not leak me')
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('never serializes a secret passed as a non-whitelisted field', () => {
    const secret = 'test_sensitive_credential_value'
    const err = Object.assign(new Error(`upstream rejected ${secret}`), { code: 'AUTH_FAILED' })
    logger.error('integration.failed', { err, tenantId: 7, credential: secret })
    const raw = errorSpy.mock.calls.at(-1)[0]
    expect(raw).not.toContain(secret)
    const line = JSON.parse(raw)
    expect(line).toMatchObject({ event: 'integration.failed', errorName: 'Error', errorCode: 'AUTH_FAILED', tenantId: 7 })
    expect(line).not.toHaveProperty('credential')
  })

  it('drops a whitelisted field whose value is not a primitive', () => {
    logger.error('x.event', { tenantId: { nested: 1 } })
    const line = lastLine(errorSpy)
    expect(line).not.toHaveProperty('tenantId')
  })

  it('falls back the event name to application.error when it fails safeCode validation', () => {
    logger.info('not a valid event!!', {})
    const line = lastLine(logSpy)
    expect(line.event).toBe('application.error')
  })

  it('enriches with requestId/tenantId/userId from the active AsyncLocalStorage store', () => {
    runWithStore({ requestId: 'r1', tenantId: 1, userId: 2 }, () => {
      logger.info('x.event', {})
    })
    const line = lastLine(logSpy)
    expect(line).toMatchObject({ requestId: 'r1', tenantId: 1, userId: 2 })
  })

  it('omits requestId/tenantId/userId entirely when no store is active', () => {
    logger.info('x.event', {})
    const line = lastLine(logSpy)
    expect(line).not.toHaveProperty('requestId')
    expect(line).not.toHaveProperty('tenantId')
    expect(line).not.toHaveProperty('userId')
  })

  it('drops a non-primitive value placed in the ALS store instead of leaking nested data', () => {
    runWithStore({ requestId: 'r1', tenantId: { nested: 'leak' } }, () => {
      logger.info('x.event', {})
    })
    const line = lastLine(logSpy)
    expect(line.requestId).toBe('r1')
    expect(line).not.toHaveProperty('tenantId')
  })

  it('drops a BigInt value placed in the ALS store without throwing', () => {
    expect(() => {
      runWithStore({ requestId: 'r1', userId: 9007199254740993n }, () => {
        logger.info('x.event', {})
      })
    }).not.toThrow()
    const line = lastLine(logSpy)
    expect(line.requestId).toBe('r1')
    expect(line).not.toHaveProperty('userId')
  })

  it('lets the ALS-derived tenantId win over a caller-supplied tenantId when both are present', () => {
    runWithStore({ requestId: 'r1', tenantId: 1 }, () => {
      logger.info('x.event', { tenantId: 99 })
    })
    const line = lastLine(logSpy)
    expect(line.tenantId).toBe(1)
  })

  it('keeps a caller-supplied tenantId when no ALS store is active', () => {
    logger.info('x.event', { tenantId: 99 })
    const line = lastLine(logSpy)
    expect(line.tenantId).toBe(99)
  })

  it('does not let errorStatus collide with a caller-supplied business status field', () => {
    const err = Object.assign(new Error('boom'), { statusCode: 500 })
    logger.error('x.event', { err, status: 'approved' })
    const line = lastLine(errorSpy)
    expect(line.status).toBe('approved')
    expect(line.errorStatus).toBe(500)
  })
})
