// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the logger so we can assert the rollback-failure warning without touching
// stdout, and so importing the helper never constructs a real pg pool path.
vi.mock('../../../server/utils/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { withTransaction, abortTransaction } from '../../../server/db/withTransaction.js'
import { logger } from '../../../server/utils/logger.js'

// A fake pg client. `failures` maps a SQL command to an Error the client should
// reject with when that command runs; everything else resolves.
function makeClient(failures = {}) {
  const calls = []
  const client = {
    query: vi.fn(async (sql) => {
      calls.push(sql)
      if (failures[sql]) throw failures[sql]
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  client.calls = calls
  return client
}

// A fake pool wrapping a single client, so the helper's `db.connect()` path is
// exercised without a real database.
function makeDb(client) {
  return { connect: vi.fn(async () => client) }
}

describe('withTransaction', () => {
  beforeEach(() => {
    logger.error.mockClear()
  })

  it('runs BEGIN/COMMIT, releases with no argument, and returns the callback result', async () => {
    const client = makeClient()
    const db = makeDb(client)

    const result = await withTransaction(async (c) => {
      expect(c).toBe(client)
      return 'ok'
    }, { db })

    expect(result).toBe('ok')
    expect(client.calls).toEqual(['BEGIN', 'COMMIT'])
    expect(client.release).toHaveBeenCalledTimes(1)
    expect(client.release).toHaveBeenCalledWith()
  })

  it('rolls back and rethrows the original error when the callback throws', async () => {
    const client = makeClient()
    const db = makeDb(client)
    const boom = new Error('callback failed')

    await expect(withTransaction(async () => { throw boom }, { db })).rejects.toBe(boom)

    expect(client.calls).toEqual(['BEGIN', 'ROLLBACK'])
    expect(client.release).toHaveBeenCalledWith()
  })

  it('does not let a failed rollback mask the original error, and evicts the client', async () => {
    const errB = new Error('rollback failed')
    const client = makeClient({ ROLLBACK: errB })
    const db = makeDb(client)
    const errA = new Error('callback failed')

    await expect(withTransaction(async () => { throw errA }, { db })).rejects.toBe(errA)

    expect(logger.error).toHaveBeenCalledWith('db.transaction.rollback_failed', { err: errB })
    // Damaged connection is released WITH the error so pg-pool removes it.
    expect(client.release).toHaveBeenCalledWith(errB)
  })

  it('rolls back and rethrows when COMMIT itself rejects', async () => {
    const errA = new Error('commit failed')
    const client = makeClient({ COMMIT: errA })
    const db = makeDb(client)

    await expect(withTransaction(async () => 'ok', { db })).rejects.toBe(errA)

    expect(client.calls).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK'])
    expect(client.release).toHaveBeenCalledWith()
  })

  it('rethrows the COMMIT error (not the rollback error) when both fail, and evicts', async () => {
    const errA = new Error('commit failed')
    const errB = new Error('rollback failed')
    const client = makeClient({ COMMIT: errA, ROLLBACK: errB })
    const db = makeDb(client)

    await expect(withTransaction(async () => 'ok', { db })).rejects.toBe(errA)

    expect(logger.error).toHaveBeenCalledWith('db.transaction.rollback_failed', { err: errB })
    expect(client.release).toHaveBeenCalledWith(errB)
  })

  it('rolls back without committing and returns the result on abortTransaction', async () => {
    const client = makeClient()
    const db = makeDb(client)
    const aborted = { error: { status: 400, body: { error: 'bad' } } }

    const result = await withTransaction(async () => {
      abortTransaction(aborted)
    }, { db })

    expect(result).toBe(aborted)
    expect(client.calls).toEqual(['BEGIN', 'ROLLBACK'])
    expect(client.release).toHaveBeenCalledWith()
  })

  it('returns a mapped result when mapError resolves one, otherwise rethrows', async () => {
    const mappedClient = makeClient()
    const err = new Error('translate me')

    const mapped = await withTransaction(async () => { throw err }, {
      db: makeDb(mappedClient),
      mapError: async (e) => (e === err ? { error: 'mapped' } : null),
    })
    expect(mapped).toEqual({ error: 'mapped' })

    const passthroughClient = makeClient()
    await expect(withTransaction(async () => { throw err }, {
      db: makeDb(passthroughClient),
      mapError: async () => null,
    })).rejects.toBe(err)
  })

  it('uses a caller-provided client and never releases it', async () => {
    const client = makeClient({ ROLLBACK: new Error('rollback failed') })
    const err = new Error('callback failed')

    await expect(withTransaction(async () => { throw err }, { client })).rejects.toBe(err)

    expect(client.calls).toEqual(['BEGIN', 'ROLLBACK'])
    expect(client.release).not.toHaveBeenCalled()
  })
})
