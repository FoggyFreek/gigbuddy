import './_envSetup.js'
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let pool, runMigrations, truncateAll
let seedTwoTenants, seedBandMembers, seedGigsAndTasks, seedCalendar
let seedContactsAndVenues, seedSharePhotos, seedAccountingForTenants

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  seedBandMembers = dbMod.seedBandMembers
  seedGigsAndTasks = dbMod.seedGigsAndTasks
  seedCalendar = dbMod.seedCalendar
  seedContactsAndVenues = dbMod.seedContactsAndVenues
  seedSharePhotos = dbMod.seedSharePhotos
  seedAccountingForTenants = dbMod.seedAccountingForTenants
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await pool.end()
})

async function count(table) {
  const { rows: [row] } = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`)
  return row.count
}

describe('backend fixture policy', () => {
  it('keeps the default fixture limited to tenants, users, and memberships', async () => {
    const seed = await seedTwoTenants()

    expect(seed).toEqual(expect.objectContaining({
      tenantA: expect.any(Object),
      tenantB: expect.any(Object),
      userA: expect.any(Object),
      userB: expect.any(Object),
      superUser: expect.any(Object),
    }))
    expect(seed).not.toHaveProperty('memberA')
    expect(seed).not.toHaveProperty('gigA')
    expect(await count('band_members')).toBe(0)
    expect(await count('gigs')).toBe(0)
    expect(await count('rehearsals')).toBe(0)
    expect(await count('venues')).toBe(0)
    expect(await count('share_photos')).toBe(0)
    expect(await count('chart_of_accounts')).toBe(0)
    expect(await count('tenant_accounting_settings')).toBe(0)
    expect(await count('tenant_accounting_profiles')).toBe(0)
  })

  it('adds only the requested non-finance fixture slices', async () => {
    let seed = await seedTwoTenants()
    seed = await seedBandMembers(seed)
    seed = await seedGigsAndTasks(seed)
    seed = await seedCalendar(seed)
    seed = await seedContactsAndVenues(seed)
    seed = await seedSharePhotos(seed)

    expect(seed).toEqual(expect.objectContaining({
      memberA: expect.any(Object),
      memberB: expect.any(Object),
      gigA: expect.any(Object),
      gigB: expect.any(Object),
      rehearsalA: expect.any(Object),
      rehearsalB: expect.any(Object),
      venues: expect.any(Array),
      contacts: expect.any(Array),
      sharePhotos: expect.any(Array),
    }))
    expect(await count('band_members')).toBe(2)
    expect(await count('gigs')).toBe(2)
    expect(await count('gig_tasks')).toBe(2)
    expect(await count('rehearsals')).toBe(2)
    expect(await count('band_events')).toBe(2)
    expect(await count('availability_slots')).toBe(2)
    expect(await count('venues')).toBe(2)
    expect(await count('contacts')).toBe(2)
    expect(await count('share_photos')).toBe(2)
    expect(await count('chart_of_accounts')).toBe(0)
  })

  it('adds tenant accounting only when requested', async () => {
    const seed = await seedTwoTenants()
    await seedAccountingForTenants(seed)

    expect(await count('chart_of_accounts')).toBeGreaterThan(0)
    expect(await count('tenant_accounting_settings')).toBe(2)
    expect(await count('tenant_accounting_profiles')).toBe(2)
  })
})
