// Shared transaction runner. The one place that owns the BEGIN/COMMIT/ROLLBACK
// dance so services don't hand-roll it (and can't mask the original error with a
// failed rollback). Only for owners that START a transaction — code that merely
// participates in a caller's transaction should keep taking an existing client.
import pool from './index.js'
import { logger } from '../utils/logger.js'

// Sentinel thrown via abortTransaction() when a callback wants a deliberate
// rollback that still returns `result` normally (validation failures that used
// to do `await client.query('ROLLBACK'); return { error }` mid-transaction).
class TransactionAbort {
  constructor(result) {
    this.result = result
  }
}

export function abortTransaction(result) {
  throw new TransactionAbort(result)
}

// Runs `callback(client)` inside BEGIN/COMMIT. On any throw it rolls back
// WITHOUT letting a rollback failure mask the original error, and evicts a
// helper-owned connection that failed to roll back.
//
//   opts.client   – run on this caller-owned client; the caller keeps ownership
//                   and this helper never releases it. Default: a fresh pool
//                   connection that we own and release.
//   opts.db       – pool to connect from when we own the client (default: the
//                   app pool). Owners that acquire from an injected db/pool
//                   parameter MUST forward it here, or they silently switch to
//                   the global pool.
//   opts.mapError – async (err) => result | null | undefined. Runs AFTER the
//                   rollback, in the catch. A non-null result is returned
//                   (deliberate error translation, e.g. 23505 -> conflict);
//                   null/undefined rethrows the original error. Because it runs
//                   post-rollback it can never turn into an accidental commit.
export async function withTransaction(callback, { client: providedClient, db = pool, mapError } = {}) {
  const client = providedClient ?? (await db.connect())
  let rollbackError = null
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch (rbErr) {
      // The real error is `err`; a failed rollback must never replace it.
      rollbackError = rbErr
      logger.error('db.transaction.rollback_failed', { err: rbErr })
    }
    if (err instanceof TransactionAbort) return err.result
    if (mapError) {
      const mapped = await mapError(err)
      if (mapped != null) return mapped
    }
    throw err
  } finally {
    // Only release clients we own. Passing an error to release() removes the
    // damaged client from the pool (pg-pool _release -> _remove); a plain
    // release would recycle a broken connection.
    if (!providedClient) {
      if (rollbackError) client.release(rollbackError)
      else client.release()
    }
  }
}
