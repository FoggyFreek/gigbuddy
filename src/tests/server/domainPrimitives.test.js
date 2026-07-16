// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { fetchTenant } from '../../../server/repositories/tenantRepository.js'
import { songExistsInTenant } from '../../../server/repositories/songRepository.js'
import { bandMemberExistsInTenant } from '../../../server/repositories/bandMemberRepository.js'
import { insertLedgerEntries } from '../../../server/repositories/ledgerRepository.js'
import { normalizeIban } from '../../../server/utils/normalizeIban.js'

describe('aggregate-owned repository primitives', () => {
  it('reads a tenant through the tenant repository', async () => {
    const tenant = { id: 7, band_name: 'The Aggregates' }
    const executor = { query: vi.fn().mockResolvedValue({ rows: [tenant] }) }

    await expect(fetchTenant(executor, 7)).resolves.toBe(tenant)
    expect(executor.query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM tenants WHERE id = \$1/),
      [7],
    )
  })

  it('checks song existence through the song repository with tenant scope', async () => {
    const executor = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) }

    await expect(songExistsInTenant(executor, 11, 7)).resolves.toBe(true)
    expect(executor.query).toHaveBeenCalledWith(
      'SELECT 1 FROM songs WHERE id = $1 AND tenant_id = $2',
      [11, 7],
    )
  })

  it('checks band-member existence through the band-member repository with tenant scope', async () => {
    const executor = { query: vi.fn().mockResolvedValue({ rowCount: 0 }) }

    await expect(bandMemberExistsInTenant(executor, 13, 7)).resolves.toBe(false)
    expect(executor.query).toHaveBeenCalledWith(
      'SELECT 1 FROM band_members WHERE id = $1 AND tenant_id = $2',
      [13, 7],
    )
  })

  it('inserts every ledger line in one batch query', async () => {
    const executor = { query: vi.fn().mockResolvedValue({}) }
    const lines = [
      { account_code: '11000', debit_cents: 1250, credit_cents: 0, memo: 'Bank' },
      { account_code: '41000', debit_cents: 0, credit_cents: 1250, memo: null },
    ]

    await insertLedgerEntries(executor, 7, 42, lines)

    expect(executor.query).toHaveBeenCalledTimes(1)
    expect(executor.query).toHaveBeenCalledWith(
      expect.stringMatching(/UNNEST/i),
      [7, 42, ['11000', '41000'], [1250, 0], [0, 1250], ['Bank', null]],
    )
  })
})

describe('normalizeIban', () => {
  it('normalizes whitespace and casing for validation and statement parsing', () => {
    expect(normalizeIban(' nl91 abna 0417 1643 00 ')).toBe('NL91ABNA0417164300')
    expect(normalizeIban('nl91\tabna\n0417164300')).toBe('NL91ABNA0417164300')
  })

  it('normalizes nullish and blank values to null', () => {
    expect(normalizeIban(null)).toBeNull()
    expect(normalizeIban(undefined)).toBeNull()
    expect(normalizeIban('   ')).toBeNull()
  })
})
