import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import pool from '../../../db/index.js'
import { logger } from '../../../utils/logger.js'
import {
  CREDENTIAL_TYPES,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  parseIntegrationSecretsConfig,
} from '../../../security/integrationSecrets.js'

const CREDENTIALS = Object.freeze([
  {
    type: CREDENTIAL_TYPES.MOLLIE_API_KEY,
    encrypted: 'mollie_api_key_encrypted', changedAt: 'mollie_api_key_changed_at',
  },
  {
    type: CREDENTIAL_TYPES.SHOPIFY_CLIENT_SECRET,
    encrypted: 'shopify_client_secret_encrypted', changedAt: 'shopify_client_secret_changed_at',
  },
  {
    type: CREDENTIAL_TYPES.BANDSINTOWN_APP_ID,
    encrypted: 'bandsintown_app_id_encrypted', changedAt: 'bandsintown_app_id_changed_at',
  },
  {
    type: CREDENTIAL_TYPES.RESEND_API_KEY,
    encrypted: 'resend_api_key_encrypted', changedAt: 'resend_api_key_changed_at',
  },
])

function emptyCounts(tenantCount) {
  return {
    tenants: tenantCount,
    encrypted: 0,
    corrupt: 0,
    reEncryptionNeeded: 0,
    reEncrypted: 0,
  }
}

function scanCredential(row, credential, config, counts, operations) {
  const envelope = row[credential.encrypted]
  if (envelope === null) return
  counts.encrypted += 1
  try {
    const value = decryptIntegrationSecret(envelope, row.id, credential.type, config)
    if (envelope.kid !== config.activeKeyId) {
      counts.reEncryptionNeeded += 1
      operations.push({ row, credential, value })
    }
  } catch {
    counts.corrupt += 1
  }
}

// Re-encrypts under the active key without touching the credential's
// changed_at: rotation is not a credential change.
async function applyOperation(executor, operation, config) {
  const { row, credential, value } = operation
  const envelope = encryptIntegrationSecret(value, row.id, credential.type, config)
  decryptIntegrationSecret(envelope, row.id, credential.type, config)
  await executor.query(
    `UPDATE tenant_integrations
        SET ${credential.encrypted} = $1::jsonb, updated_at = NOW()
      WHERE tenant_id = $2`,
    [JSON.stringify(envelope), row.id],
  )
}

export async function rotateIntegrationSecrets(executor, { apply = false } = {}) {
  const config = parseIntegrationSecretsConfig()
  await executor.query('BEGIN')
  try {
    const { rows } = await executor.query(
      `SELECT tenant_id AS id,
              mollie_api_key_encrypted, mollie_api_key_changed_at,
              shopify_client_secret_encrypted, shopify_client_secret_changed_at,
              bandsintown_app_id_encrypted, bandsintown_app_id_changed_at,
              resend_api_key_encrypted, resend_api_key_changed_at
         FROM tenant_integrations ORDER BY tenant_id FOR UPDATE`,
    )
    const counts = emptyCounts(rows.length)
    const operations = []
    for (const row of rows) {
      for (const credential of CREDENTIALS) {
        scanCredential(row, credential, config, counts, operations)
      }
    }

    if (counts.corrupt) {
      await executor.query('ROLLBACK')
      return { counts, ok: false }
    }

    if (apply) {
      for (const operation of operations) {
        await applyOperation(executor, operation, config)
        counts.reEncrypted += 1
      }
      await executor.query('COMMIT')
    } else {
      await executor.query('ROLLBACK')
    }
    return { counts, ok: true }
  } catch (err) {
    await executor.query('ROLLBACK').catch(() => {})
    throw err
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !['--check', '--apply'].includes(args[0])) {
    throw new Error('Usage: npm run rotate:integration-secrets -- --check|--apply')
  }
  const result = await rotateIntegrationSecrets(pool, { apply: args[0] === '--apply' })
  logger.info('integration_secret_rotation.completed', { mode: args[0].slice(2), ...result.counts })
  if (!result.ok) process.exitCode = 2
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (err) {
    logger.error('integration_secret_rotation.failed', { err })
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
