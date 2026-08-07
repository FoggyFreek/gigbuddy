// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { fetchTenant } from '../../../server/repositories/tenantRepository.js'
import { songExistsInTenant } from '../../../server/repositories/songRepository.js'
import {
  bandMemberExistsInTenant,
  getBandMemberIdForUser,
} from '../../../server/repositories/bandMemberRepository.js'
import * as gigRepository from '../../../server/repositories/gigRepository.js'
import * as rehearsalRepository from '../../../server/repositories/rehearsalRepository.js'
import { insertLedgerEntries } from '../../../server/repositories/ledgerRepository.js'
import { limitedCollectionWithCursor } from '../../../server/services/limitedCollectionService.js'
import { memberTenantScope } from '../../../server/domain/memberTenants.js'
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

  it('resolves the roster row for a user through the band-member repository', async () => {
    const executor = { query: vi.fn().mockResolvedValue({ rows: [{ id: 5 }] }) }

    await expect(getBandMemberIdForUser(executor, 3, 7)).resolves.toBe(5)
    expect(executor.query).toHaveBeenCalledWith(
      'SELECT id FROM band_members WHERE user_id = $1 AND tenant_id = $2',
      [3, 7],
    )
  })

  it('returns null when the user has no roster row in the tenant', async () => {
    const executor = { query: vi.fn().mockResolvedValue({ rows: [] }) }

    await expect(getBandMemberIdForUser(executor, 3, 7)).resolves.toBeNull()
  })

  // The band_members lookup used to live in the gig and rehearsal repositories
  // as two identical copies. Aggregate repositories must not grow a third.
  it('keeps the roster lookup out of the gig and rehearsal repositories', () => {
    expect(gigRepository.getBandMemberIdForUser).toBeUndefined()
    expect(rehearsalRepository.getBandMemberIdForUser).toBeUndefined()
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

describe('memberTenantScope', () => {
  const tenants = [
    { tenantId: 4, kind: 'band', displayName: 'Alpha Band', avatarPath: 'tenants/4/logo.png', role: 'reader' },
    { tenantId: 9, kind: 'personal', displayName: 'My Workspace', avatarPath: null, role: 'tenant_admin' },
  ]

  it('prepares the ids and the index once for the whole request', () => {
    const scope = memberTenantScope(tenants)

    expect(scope.ids).toEqual([4, 9])
    expect(scope.byId.get(9)).toBe(tenants[1])
  })

  it('labels a row with the tenant it came from', () => {
    const scope = memberTenantScope(tenants)

    expect(scope.label({ id: 1, tenant_id: 4, title: 'Show' })).toEqual({
      id: 1,
      tenant_id: 4,
      title: 'Show',
      tenantId: 4,
      tenantName: 'Alpha Band',
      tenantAvatarPath: 'tenants/4/logo.png',
      kind: 'band',
    })
  })

  // A row can only reach a label through a member-tenant query, so an unknown
  // id means a bug — it must not invent a name, and it must not throw either.
  it('blanks the reference for a tenant outside the scope', () => {
    expect(memberTenantScope(tenants).ref(77)).toEqual({
      tenantId: 77,
      tenantName: null,
      tenantAvatarPath: null,
      kind: null,
    })
  })

  it('is empty, not broken, for a user with no memberships', () => {
    const scope = memberTenantScope([])

    expect(scope.ids).toEqual([])
    expect(scope.byId.size).toBe(0)
  })
})

describe('limitedCollectionWithCursor', () => {
  const rows = [{ id: 3, event_date: '2098-02-01' }, { id: 1, event_date: '2098-01-01' }]
  const dateOf = (row) => row.event_date

  it('emits a keyset cursor from the last row of a full page', async () => {
    const result = await limitedCollectionWithCursor(2, async () => rows, dateOf)

    expect(result.items).toEqual(rows)
    expect(result.meta).toEqual({
      limit: 2,
      returned: 2,
      nextCursor: { date: '2098-01-01', id: 1 },
    })
  })

  // A page short of its limit is the last page — offering a cursor there would
  // send the client on a round trip that can only come back empty.
  it('emits no cursor when the page is short of the limit', async () => {
    const result = await limitedCollectionWithCursor(10, async () => rows, dateOf)

    expect(result.meta.nextCursor).toBeNull()
  })

  it('emits no cursor for an empty page', async () => {
    const result = await limitedCollectionWithCursor(10, async () => [], dateOf)

    expect(result.items).toEqual([])
    expect(result.meta.nextCursor).toBeNull()
  })

  it('normalizes a Date accessor onto the day string the cursor parser accepts', async () => {
    const result = await limitedCollectionWithCursor(
      1, async () => [{ id: 9, day: new Date('2098-03-04T22:00:00Z') }], (row) => row.day,
    )

    expect(result.meta.nextCursor).toEqual({ date: '2098-03-04', id: 9 })
  })

  it('rejects a malformed limit before touching the database', async () => {
    const fetchItems = vi.fn()
    const result = await limitedCollectionWithCursor('0', fetchItems, dateOf)

    expect(result.error).toEqual({ status: 400, body: { error: 'limit must be an integer between 1 and 100' } })
    expect(fetchItems).not.toHaveBeenCalled()
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
