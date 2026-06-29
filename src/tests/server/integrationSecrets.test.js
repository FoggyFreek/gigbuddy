// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  CREDENTIAL_TYPES,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  parseIntegrationSecretsConfig,
} from '../../../server/security/integrationSecrets.js'
import { logError } from '../../../server/utils/redactedLogger.js'

const keyA = Buffer.alloc(32, 0x11).toString('base64')
const keyB = Buffer.alloc(32, 0x22).toString('base64')
const configA = parseIntegrationSecretsConfig({
  INTEGRATION_SECRETS_KEYS: JSON.stringify({ a: keyA }),
  INTEGRATION_SECRETS_ACTIVE_KEY_ID: 'a',
})
const configB = parseIntegrationSecretsConfig({
  INTEGRATION_SECRETS_KEYS: JSON.stringify({ b: keyB }),
  INTEGRATION_SECRETS_ACTIVE_KEY_ID: 'b',
})
const wrongKeyForA = parseIntegrationSecretsConfig({
  INTEGRATION_SECRETS_KEYS: JSON.stringify({ a: keyB }),
  INTEGRATION_SECRETS_ACTIVE_KEY_ID: 'a',
})

describe('integration secret AES-256-GCM envelopes', () => {
  const type = CREDENTIAL_TYPES.MOLLIE_API_KEY

  it('round-trips and randomizes ciphertext', () => {
    const first = encryptIntegrationSecret('test_secret', 1, type, configA)
    const second = encryptIntegrationSecret('test_secret', 1, type, configA)
    expect(decryptIntegrationSecret(first, 1, type, configA)).toBe('test_secret')
    expect(first.ct).not.toBe(second.ct)
    expect(first.iv).not.toBe(second.iv)
  })

  it('rejects wrong keys, modified tags, tenant swaps, and field swaps', () => {
    const envelope = encryptIntegrationSecret('test_secret', 1, type, configA)
    expect(() => decryptIntegrationSecret(envelope, 1, type, configB)).toThrow()
    expect(() => decryptIntegrationSecret(envelope, 1, type, wrongKeyForA)).toThrow()
    expect(() => decryptIntegrationSecret({ ...envelope, tag: Buffer.alloc(16).toString('base64') }, 1, type, configA)).toThrow()
    expect(() => decryptIntegrationSecret(envelope, 2, type, configA)).toThrow()
    expect(() => decryptIntegrationSecret(envelope, 1, CREDENTIAL_TYPES.SHOPIFY_CLIENT_SECRET, configA)).toThrow()
  })

  it('rejects malformed envelopes and missing key configuration', () => {
    expect(() => decryptIntegrationSecret({ v: 1 }, 1, type, configA)).toThrow()
    expect(() => parseIntegrationSecretsConfig({})).toThrow('integration_secrets_keys_invalid')
    expect(() => parseIntegrationSecretsConfig({
      INTEGRATION_SECRETS_KEYS: JSON.stringify({ a: 'bad' }),
      INTEGRATION_SECRETS_ACTIVE_KEY_ID: 'a',
    })).toThrow('integration_secrets_key_invalid')
  })
})

describe('redacted integration logging', () => {
  it('never serializes error messages, stacks, secrets, or unapproved context', () => {
    const secret = 'test_sensitive_credential_value'
    const output = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const err = Object.assign(new Error(`upstream rejected ${secret}`), { code: 'AUTH_FAILED' })
      logError('integration.failed', err, { tenantId: 7, credential: secret })
      const line = output.mock.calls[0][0]
      expect(line).not.toContain(secret)
      expect(JSON.parse(line)).toMatchObject({
        event: 'integration.failed', errorName: 'Error', errorCode: 'AUTH_FAILED', tenantId: 7,
      })
      expect(JSON.parse(line)).not.toHaveProperty('credential')
    } finally {
      output.mockRestore()
    }
  })
})
