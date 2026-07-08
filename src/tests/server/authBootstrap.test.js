import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterEach, expect } from 'vitest'

// Multi-provider OIDC bootstrap invariants (Google + personal Microsoft):
// - claim verification is strictly typed (only boolean true passes email_verified)
// - sign-in resolves by provider sub ONLY — an email collision is rejected,
//   never auto-linked and never created (account_exists)
// - the ADMIN_EMAIL super-admin bootstrap requires a verified email claim
// - linking a second provider is an explicit service call that never
//   overwrites an occupied slot or steals a sub from another user
let pool, runMigrations, truncateAll, seedTwoTenants
let oidc, authService
let seed

const savedAdminEmail = process.env.ADMIN_EMAIL

function googleClaims(overrides = {}) {
  return {
    sub: 'g-sub-new',
    email: 'new@test.local',
    email_verified: true,
    name: 'New User',
    picture: 'https://example.com/p.png',
    ...overrides,
  }
}

function microsoftClaims(overrides = {}) {
  return {
    sub: 'ms-sub-new',
    email: 'new@test.local',
    name: 'New User',
    ...overrides,
  }
}

async function getUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email])
  return rows[0] || null
}

beforeAll(async () => {
  const dbMod = await import('./_db.js')
  pool = dbMod.pool
  runMigrations = dbMod.runMigrations
  truncateAll = dbMod.truncateAll
  seedTwoTenants = dbMod.seedTwoTenants
  oidc = await import('../../../server/oidc.js')
  authService = await import('../../../server/services/authService.js')
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
})

afterEach(() => {
  process.env.ADMIN_EMAIL = savedAdminEmail
})

describe('validateProviderClaims', () => {
  it('accepts google claims with boolean email_verified true', () => {
    expect(() => oidc.validateProviderClaims('google', googleClaims())).not.toThrow()
  })

  it.each([
    ['string "true"', 'true'],
    ['string "false"', 'false'],
    ['boolean false', false],
    ['number 1', 1],
    ['missing', undefined],
  ])('rejects google claims when email_verified is %s', (_label, value) => {
    const claims = googleClaims()
    if (value === undefined) delete claims.email_verified
    else claims.email_verified = value
    expect(() => oidc.validateProviderClaims('google', claims)).toThrow(
      expect.objectContaining({ status: 403 }),
    )
  })

  it('rejects google claims without an email', () => {
    expect(() => oidc.validateProviderClaims('google', googleClaims({ email: undefined }))).toThrow(
      expect.objectContaining({ status: 403 }),
    )
  })

  it('accepts microsoft claims with a non-empty email and sub', () => {
    expect(() => oidc.validateProviderClaims('microsoft', microsoftClaims())).not.toThrow()
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['non-string', 42],
  ])('rejects microsoft claims when email is %s', (_label, value) => {
    const claims = microsoftClaims()
    if (value === undefined) delete claims.email
    else claims.email = value
    expect(() => oidc.validateProviderClaims('microsoft', claims)).toThrow(
      expect.objectContaining({ status: 403 }),
    )
  })

  it('rejects microsoft claims without a sub', () => {
    expect(() => oidc.validateProviderClaims('microsoft', microsoftClaims({ sub: undefined }))).toThrow()
  })

  it('rejects an unknown provider', () => {
    expect(() => oidc.validateProviderClaims('github', googleClaims())).toThrow()
  })
})

describe('bootstrapCallbackUser — sign-in resolution by sub only', () => {
  it('creates a new user from a first google sign-in', async () => {
    const { user } = await authService.bootstrapCallbackUser(pool, 'google', googleClaims())
    expect(user.google_sub).toBe('g-sub-new')
    expect(user.microsoft_sub).toBeNull()
    expect(user.email).toBe('new@test.local')
    expect(user.is_super_admin).toBe(false)
  })

  it('creates a new user from a first microsoft sign-in', async () => {
    const { user } = await authService.bootstrapCallbackUser(pool, 'microsoft', microsoftClaims())
    expect(user.microsoft_sub).toBe('ms-sub-new')
    expect(user.google_sub).toBeNull()
    expect(user.picture_url).toBeNull()
  })

  it('rejects a microsoft sign-in whose email belongs to an existing google user (no link, no create)', async () => {
    await expect(
      authService.bootstrapCallbackUser(pool, 'microsoft', microsoftClaims({ email: 'a@test.local' })),
    ).rejects.toMatchObject({ status: 403, code: 'account_exists' })

    const userA = await getUserByEmail('a@test.local')
    expect(userA.id).toBe(seed.userA.id)
    expect(userA.microsoft_sub).toBeNull()
    const { rowCount } = await pool.query('SELECT 1 FROM users WHERE microsoft_sub = $1', ['ms-sub-new'])
    expect(rowCount).toBe(0)
  })

  it('rejects a google sign-in whose email belongs to an existing microsoft user', async () => {
    await authService.bootstrapCallbackUser(pool, 'microsoft', microsoftClaims({ email: 'ms@test.local', sub: 'ms-1' }))

    await expect(
      authService.bootstrapCallbackUser(pool, 'google', googleClaims({ email: 'ms@test.local', sub: 'g-1' })),
    ).rejects.toMatchObject({ status: 403, code: 'account_exists' })

    const user = await getUserByEmail('ms@test.local')
    expect(user.google_sub).toBeNull()
  })

  it('resolves a returning microsoft user by sub without updating the stored email', async () => {
    const { user: created } = await authService.bootstrapCallbackUser(
      pool, 'microsoft', microsoftClaims({ sub: 'ms-1', email: 'ms@test.local' }),
    )
    await pool.query('UPDATE users SET picture_url = $1 WHERE id = $2', ['stored.png', created.id])

    const { user } = await authService.bootstrapCallbackUser(
      pool, 'microsoft', microsoftClaims({ sub: 'ms-1', email: 'changed@test.local', name: 'Renamed' }),
    )
    expect(user.id).toBe(created.id)
    // Microsoft emails carry no verified claim — never used to update the account.
    expect(user.email).toBe('ms@test.local')
    expect(user.name).toBe('Renamed')
    // No picture claim from MSA — the stored picture survives.
    expect(user.picture_url).toBe('stored.png')
  })

  it('refreshes email and picture for a returning google user (verified claims)', async () => {
    const { user } = await authService.bootstrapCallbackUser(
      pool, 'google', googleClaims({ sub: 'sub-a', email: 'a-renamed@test.local', picture: 'new.png' }),
    )
    expect(user.id).toBe(seed.userA.id)
    expect(user.email).toBe('a-renamed@test.local')
    expect(user.picture_url).toBe('new.png')
  })
})

describe('bootstrapCallbackUser — ADMIN_EMAIL super-admin bootstrap', () => {
  beforeEach(async () => {
    // The seed includes a super admin; demote so the bootstrap window is open
    // (seed tenant id 1 must exist for the seed-admin membership).
    await pool.query('UPDATE users SET is_super_admin = FALSE')
    process.env.ADMIN_EMAIL = 'admin@test.local'
  })

  it('never grants super admin to a microsoft sign-in (no verified email claim exists)', async () => {
    const { user } = await authService.bootstrapCallbackUser(
      pool, 'microsoft', microsoftClaims({ email: 'admin@test.local' }),
    )
    expect(user.is_super_admin).toBe(false)
  })

  it('never grants super admin when email_verified is the string "true"', async () => {
    const { user } = await authService.bootstrapCallbackUser(
      pool, 'google', googleClaims({ email: 'admin@test.local', email_verified: 'true' }),
    )
    expect(user.is_super_admin).toBe(false)
  })

  it('grants super admin to a verified google sign-in matching ADMIN_EMAIL', async () => {
    const { user } = await authService.bootstrapCallbackUser(
      pool, 'google', googleClaims({ email: 'admin@test.local' }),
    )
    expect(user.is_super_admin).toBe(true)
  })
})

describe('link / unlink provider identities', () => {
  it('links a microsoft identity onto an empty slot', async () => {
    const result = await authService.linkProviderIdentity(pool, seed.userA.id, 'microsoft', microsoftClaims({ sub: 'ms-link' }))
    expect(result.error).toBeUndefined()

    const userA = await getUserByEmail('a@test.local')
    expect(userA.microsoft_sub).toBe('ms-link')
    // Linking never touches the account's email.
    expect(userA.email).toBe('a@test.local')
  })

  it('refuses to overwrite an occupied slot', async () => {
    await authService.linkProviderIdentity(pool, seed.userA.id, 'microsoft', microsoftClaims({ sub: 'ms-link' }))
    const result = await authService.linkProviderIdentity(pool, seed.userA.id, 'microsoft', microsoftClaims({ sub: 'ms-other' }))
    expect(result.error?.status).toBe(409)

    const userA = await getUserByEmail('a@test.local')
    expect(userA.microsoft_sub).toBe('ms-link')
  })

  it('refuses a sub already linked to another user', async () => {
    await authService.linkProviderIdentity(pool, seed.userA.id, 'microsoft', microsoftClaims({ sub: 'ms-link' }))
    const result = await authService.linkProviderIdentity(pool, seed.userB.id, 'microsoft', microsoftClaims({ sub: 'ms-link' }))
    expect(result.error?.status).toBe(409)

    const userB = await getUserByEmail('b@test.local')
    expect(userB.microsoft_sub).toBeNull()
  })

  it('unlinks a provider when another sign-in method remains', async () => {
    await authService.linkProviderIdentity(pool, seed.userA.id, 'microsoft', microsoftClaims({ sub: 'ms-link' }))
    const result = await authService.unlinkProvider(pool, seed.userA.id, 'microsoft')
    expect(result.error).toBeUndefined()

    const userA = await getUserByEmail('a@test.local')
    expect(userA.microsoft_sub).toBeNull()
    expect(userA.google_sub).toBe('sub-a')
  })

  it('refuses to unlink the only sign-in method', async () => {
    const result = await authService.unlinkProvider(pool, seed.userA.id, 'google')
    expect(result.error?.status).toBe(409)

    const userA = await getUserByEmail('a@test.local')
    expect(userA.google_sub).toBe('sub-a')
  })
})

describe('/me payload providers', () => {
  it('reports which providers are linked', async () => {
    await authService.linkProviderIdentity(pool, seed.userA.id, 'microsoft', microsoftClaims({ sub: 'ms-link' }))

    const withBoth = await authService.buildMePayload(pool, seed.userA.id, seed.tenantA.id)
    expect(withBoth.payload.providers).toEqual({ google: true, microsoft: true })

    const googleOnly = await authService.buildMePayload(pool, seed.userB.id, seed.tenantB.id)
    expect(googleOnly.payload.providers).toEqual({ google: true, microsoft: false })
  })
})
