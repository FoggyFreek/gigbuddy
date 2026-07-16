// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { assertTestDatabase, resolveTestDatabase } from './_databaseGuard.js'

const validEnv = {
  NODE_ENV: 'test',
  GIGBUDDY_TEST_DATABASE: 'gigbuddy_test',
}

const executorFor = (database) => ({
  query: vi.fn().mockResolvedValue({ rows: [{ database }] }),
})

describe('test database mutation guard', () => {
  it('uses an explicitly configured test database', () => {
    expect(resolveTestDatabase({
      PGDATABASE: 'gigbuddy',
      PGDATABASE_TEST: 'isolated_gigbuddy_test',
    })).toBe('isolated_gigbuddy_test')
  })

  it('uses a dedicated credential database directly when it already ends in _test', () => {
    expect(resolveTestDatabase({ PGDATABASE: 'gigbuddy_test' })).toBe('gigbuddy_test')
  })

  it('derives the conventional test database from development credentials', () => {
    expect(resolveTestDatabase({ PGDATABASE: 'gigbuddy' })).toBe('gigbuddy_test')
  })

  it('rejects a missing bootstrap marker before querying the database', async () => {
    const executor = executorFor('gigbuddy_test')

    await expect(assertTestDatabase(executor, { NODE_ENV: 'test' }))
      .rejects.toThrow('test database bootstrap marker is missing')
    expect(executor.query).not.toHaveBeenCalled()
  })

  it('rejects execution outside NODE_ENV=test', async () => {
    const executor = executorFor('gigbuddy_test')

    await expect(assertTestDatabase(executor, { ...validEnv, NODE_ENV: 'development' }))
      .rejects.toThrow('NODE_ENV is not test')
    expect(executor.query).not.toHaveBeenCalled()
  })

  it('rejects a configured database without the required _test suffix', async () => {
    const executor = executorFor('gigbuddy')

    await expect(assertTestDatabase(executor, {
      ...validEnv,
      GIGBUDDY_TEST_DATABASE: 'gigbuddy',
    })).rejects.toThrow("configured test database 'gigbuddy' does not end in '_test'")
    expect(executor.query).not.toHaveBeenCalled()
  })

  it('rejects when PostgreSQL is connected to a different database', async () => {
    const executor = executorFor('gigbuddy')

    await expect(assertTestDatabase(executor, validEnv))
      .rejects.toThrow("connected to 'gigbuddy', expected 'gigbuddy_test'")
  })

  it('allows the exact bootstrapped _test database', async () => {
    const executor = executorFor('gigbuddy_test')

    await expect(assertTestDatabase(executor, validEnv)).resolves.toBeUndefined()
    expect(executor.query).toHaveBeenCalledWith('SELECT current_database() AS database')
  })
})
