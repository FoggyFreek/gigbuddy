import './_envSetup.js'
// @vitest-environment node
import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest'

let pool, runMigrations, truncateAll, seedTwoTenants
let migrateIntegrationSecrets, loadIntegrationCredential, setIntegrationCredential, CREDENTIAL_TYPES
let seed

beforeAll(async () => {
  const db = await import('./_db.js')
  ;({ pool, runMigrations, truncateAll, seedTwoTenants } = db)
  ;({ migrateIntegrationSecrets } = await import('../../../server/scripts/migrateIntegrationSecrets.js'))
  ;({ loadIntegrationCredential, setIntegrationCredential } = await import('../../../server/services/integrationCredentialService.js'))
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

describe('integration credential migration', () => {
  it('migrates legacy values, verifies them, nulls plaintext, and is idempotent', async () => {
    await pool.query(
      `INSERT INTO tenant_integrations (mollie_api_key, shopify_client_secret, tenant_id)
       VALUES ($1, $2, $3)`,
      ['test_legacy_mollie', 'legacy_shopify', seed.tenantA.id],
    )

    const check = await migrateIntegrationSecrets(pool)
    expect(check).toMatchObject({ ok: true, counts: { migrationNeeded: 2, migrated: 0 } })

    const applied = await migrateIntegrationSecrets(pool, { apply: true })
    expect(applied).toMatchObject({ ok: true, counts: { migrated: 2, plaintextRemaining: 0 } })
    const { rows: [row] } = await pool.query(
      `SELECT mollie_api_key, shopify_client_secret, mollie_api_key_changed_at,
              shopify_client_secret_changed_at
         FROM tenant_integrations WHERE tenant_id = $1`,
      [seed.tenantA.id],
    )
    expect(row.mollie_api_key).toBeNull()
    expect(row.shopify_client_secret).toBeNull()
    expect(row.mollie_api_key_changed_at).not.toBeNull()
    expect(row.shopify_client_secret_changed_at).not.toBeNull()
    await expect(loadIntegrationCredential(pool, seed.tenantA.id, CREDENTIAL_TYPES.MOLLIE_API_KEY))
      .resolves.toBe('test_legacy_mollie')

    const repeated = await migrateIntegrationSecrets(pool, { apply: true })
    expect(repeated).toMatchObject({ ok: true, counts: { migrated: 0, reEncrypted: 0, plaintextRemaining: 0 } })
  })

  it('detects mixed conflicts and corrupted envelopes without modifying rows', async () => {
    await pool.query(
      `INSERT INTO tenant_integrations (
         mollie_api_key, mollie_api_key_encrypted, shopify_client_secret_encrypted, tenant_id
       ) VALUES ($1, $2::jsonb, $3::jsonb, $4)`,
      ['legacy', '{}', '{}', seed.tenantA.id],
    )
    const result = await migrateIntegrationSecrets(pool, { apply: true })
    expect(result).toMatchObject({ ok: false, counts: { conflicts: 1, corrupt: 1 } })
    const { rows: [row] } = await pool.query(
      'SELECT mollie_api_key FROM tenant_integrations WHERE tenant_id = $1',
      [seed.tenantA.id],
    )
    expect(row.mollie_api_key).toBe('legacy')
  })

  it('fails closed when encrypted data is corrupt even if plaintext exists', async () => {
    await pool.query(
      `INSERT INTO tenant_integrations (mollie_api_key, mollie_api_key_encrypted, tenant_id)
       VALUES ($1, $2::jsonb, $3)`,
      ['must-not-fallback', '{}', seed.tenantA.id],
    )
    await expect(loadIntegrationCredential(pool, seed.tenantA.id, CREDENTIAL_TYPES.MOLLIE_API_KEY))
      .rejects.toThrow()
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

      const result = await migrateIntegrationSecrets(pool, { apply: true })
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
