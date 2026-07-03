import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const ENVELOPE_VERSION = 1
export const CREDENTIAL_TYPES = Object.freeze({
  MOLLIE_API_KEY: 'mollie_api_key',
  SHOPIFY_CLIENT_SECRET: 'shopify_client_secret',
  BANDSINTOWN_APP_ID: 'bandsintown_app_id',
})

const VALID_TYPES = new Set(Object.values(CREDENTIAL_TYPES))

export class IntegrationSecretError extends Error {
  constructor(code) {
    super(code)
    this.name = 'IntegrationSecretError'
    this.code = code
  }
}

function fail(code) {
  throw new IntegrationSecretError(code)
}

function decodeBase64(value, expectedLength, code) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail(code)
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== expectedLength || decoded.toString('base64') !== value) fail(code)
  return decoded
}

export function parseIntegrationSecretsConfig(env = process.env) {
  let input
  try {
    input = JSON.parse(env.INTEGRATION_SECRETS_KEYS || '')
  } catch {
    fail('integration_secrets_keys_invalid')
  }
  if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).length === 0) {
    fail('integration_secrets_keys_invalid')
  }

  const keys = new Map()
  for (const [keyId, encoded] of Object.entries(input)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId)) fail('integration_secrets_key_id_invalid')
    keys.set(keyId, decodeBase64(encoded, 32, 'integration_secrets_key_invalid'))
  }

  const activeKeyId = env.INTEGRATION_SECRETS_ACTIVE_KEY_ID
  if (typeof activeKeyId !== 'string' || !keys.has(activeKeyId)) {
    fail('integration_secrets_active_key_invalid')
  }
  return { keys, activeKeyId }
}

export function validateIntegrationSecretsConfig(env = process.env) {
  parseIntegrationSecretsConfig(env)
}

function aad(tenantId, credentialType) {
  const id = Number(tenantId)
  if (!Number.isInteger(id) || id <= 0 || !VALID_TYPES.has(credentialType)) {
    fail('integration_secret_context_invalid')
  }
  return Buffer.from(JSON.stringify({ v: ENVELOPE_VERSION, tenantId: id, credentialType }), 'utf8')
}

export function encryptIntegrationSecret(plaintext, tenantId, credentialType, config = parseIntegrationSecretsConfig()) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) fail('integration_secret_value_invalid')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', config.keys.get(config.activeKeyId), iv)
  cipher.setAAD(aad(tenantId, credentialType))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    v: ENVELOPE_VERSION,
    kid: config.activeKeyId,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ciphertext.toString('base64'),
  }
}

export function decryptIntegrationSecret(envelope, tenantId, credentialType, config = parseIntegrationSecretsConfig()) {
  if (!envelope || Array.isArray(envelope) || typeof envelope !== 'object'
      || envelope.v !== ENVELOPE_VERSION || typeof envelope.kid !== 'string'
      || typeof envelope.ct !== 'string') {
    fail('integration_secret_envelope_invalid')
  }
  const key = config.keys.get(envelope.kid)
  if (!key) fail('integration_secret_key_unavailable')

  try {
    const iv = decodeBase64(envelope.iv, 12, 'integration_secret_envelope_invalid')
    const tag = decodeBase64(envelope.tag, 16, 'integration_secret_envelope_invalid')
    const ciphertext = Buffer.from(envelope.ct, 'base64')
    if (ciphertext.length === 0 || ciphertext.toString('base64') !== envelope.ct) {
      fail('integration_secret_envelope_invalid')
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(aad(tenantId, credentialType))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch (err) {
    if (err instanceof IntegrationSecretError) throw err
    fail('integration_secret_decryption_failed')
  }
}

