import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'

let pool, runMigrations, truncateAll, seedTwoTenants
let rotateIntegrationSecrets, loadIntegrationCredential, setIntegrationCredential, CREDENTIAL_TYPES
let seed

beforeAll(async () => {
  const db = await import('./_db.js')
  ;({ pool, runMigrations, truncateAll, seedTwoTenants } = db)
  ;({ rotateIntegrationSecrets } = await import('../../../server/platform/integrations/scripts/rotateIntegrationSecrets.js'))
  ;({ loadIntegrationCredential, setIntegrationCredential } = await import('../../../server/platform/integrations/integrationCredentialService.js'))
  ;({ CREDENTIAL_TYPES } = await import('../../../server/security/integrationSecrets.js'))
  await runMigrations()
})

beforeEach(async () => {
  await truncateAll()
  seed = await seedTwoTenants()
})

afterAll(async () => {
  await pool.end()
})

describe('integration credential storage', () => {
  it('reads back only what the envelope holds — there is no plaintext fallback', async () => {
    await setIntegrationCredential(pool, seed.tenantA.id, CREDENTIAL_TYPES.MOLLIE_API_KEY, 'test_encrypted_only')
    await expect(loadIntegrationCredential(pool, seed.tenantA.id, CREDENTIAL_TYPES.MOLLIE_API_KEY))
      .resolves.toBe('test_encrypted_only')

    // Row present, envelope absent → absent credential, never a fallback value.
    await pool.query(
      `INSERT INTO tenant_integrations (tenant_id, shopify_client_id) VALUES ($1, 'client-id')`,
      [seed.tenantB.id],
    )
    await expect(loadIntegrationCredential(pool, seed.tenantB.id, CREDENTIAL_TYPES.SHOPIFY_CLIENT_SECRET))
      .resolves.toBeNull()
  })

  it('fails closed when the stored envelope is corrupt', async () => {
    await pool.query(
      `INSERT INTO tenant_integrations (tenant_id, mollie_api_key_encrypted) VALUES ($1, $2::jsonb)`,
      [seed.tenantA.id, '{}'],
    )
    await expect(loadIntegrationCredential(pool, seed.tenantA.id, CREDENTIAL_TYPES.MOLLIE_API_KEY))
      .rejects.toThrow()
  })
})

describe('integration secret rotation', () => {
  it('reports nothing to do when every envelope is on the active key', async () => {
    await setIntegrationCredential(pool, seed.tenantA.id, CREDENTIAL_TYPES.MOLLIE_API_KEY, 'test_stable_value')

    const check = await rotateIntegrationSecrets(pool)
    expect(check).toMatchObject({ ok: true, counts: { encrypted: 1, reEncryptionNeeded: 0, corrupt: 0 } })

    const applied = await rotateIntegrationSecrets(pool, { apply: true })
    expect(applied).toMatchObject({ ok: true, counts: { reEncrypted: 0 } })
  })

  it('refuses to rotate when any envelope is corrupt, leaving rows untouched', async () => {
    await pool.query(
      `INSERT INTO tenant_integrations (tenant_id, mollie_api_key_encrypted) VALUES ($1, $2::jsonb)`,
      [seed.tenantA.id, '{}'],
    )
    const result = await rotateIntegrationSecrets(pool, { apply: true })
    expect(result).toMatchObject({ ok: false, counts: { corrupt: 1, reEncrypted: 0 } })
    const { rows: [row] } = await pool.query(
      'SELECT mollie_api_key_encrypted FROM tenant_integrations WHERE tenant_id = $1',
      [seed.tenantA.id],
    )
    expect(row.mollie_api_key_encrypted).toEqual({})
  })

  it('re-encrypts valid envelopes to the active key without changing the credential timestamp', async () => {
    await setIntegrationCredential(pool, seed.tenantA.id, CREDENTIAL_TYPES.MOLLIE_API_KEY, 'test_rotation_value')
    await setIntegrationCredential(pool, seed.tenantA.id, CREDENTIAL_TYPES.RESEND_API_KEY, `re_${'r'.repeat(32)}`)
    const { rows: [before] } = await pool.query(
      'SELECT mollie_api_key_changed_at, resend_api_key_changed_at FROM tenant_integrations WHERE tenant_id = $1',
      [seed.tenantA.id],
    )
    const originalKeys = process.env.INTEGRATION_SECRETS_KEYS
    const originalActive = process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID
    try {
      const keys = JSON.parse(originalKeys)
      keys.next = Buffer.alloc(32, 0x73).toString('base64')
      process.env.INTEGRATION_SECRETS_KEYS = JSON.stringify(keys)
      process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID = 'next'

      const result = await rotateIntegrationSecrets(pool, { apply: true })
      expect(result).toMatchObject({ ok: true, counts: { reEncrypted: 2 } })
      const { rows: [after] } = await pool.query(
        `SELECT mollie_api_key_encrypted, mollie_api_key_changed_at,
                resend_api_key_encrypted, resend_api_key_changed_at
           FROM tenant_integrations WHERE tenant_id = $1`,
        [seed.tenantA.id],
      )
      expect(after.mollie_api_key_encrypted.kid).toBe('next')
      expect(after.resend_api_key_encrypted.kid).toBe('next')
      expect(after.mollie_api_key_changed_at.toISOString()).toBe(before.mollie_api_key_changed_at.toISOString())
      expect(after.resend_api_key_changed_at.toISOString()).toBe(before.resend_api_key_changed_at.toISOString())
      await expect(loadIntegrationCredential(pool, seed.tenantA.id, CREDENTIAL_TYPES.MOLLIE_API_KEY))
        .resolves.toBe('test_rotation_value')
      await expect(loadIntegrationCredential(pool, seed.tenantA.id, CREDENTIAL_TYPES.RESEND_API_KEY))
        .resolves.toBe(`re_${'r'.repeat(32)}`)
    } finally {
      process.env.INTEGRATION_SECRETS_KEYS = originalKeys
      process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID = originalActive
    }
  })
})
