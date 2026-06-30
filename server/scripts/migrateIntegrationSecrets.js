import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import pool from '../db/index.js'
import { logger } from '../utils/logger.js'
import {
  CREDENTIAL_TYPES,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  parseIntegrationSecretsConfig,
} from '../security/integrationSecrets.js'

const CREDENTIALS = Object.freeze([
  {
    type: CREDENTIAL_TYPES.MOLLIE_API_KEY,
    legacy: 'mollie_api_key', encrypted: 'mollie_api_key_encrypted', changedAt: 'mollie_api_key_changed_at',
  },
  {
    type: CREDENTIAL_TYPES.SHOPIFY_CLIENT_SECRET,
    legacy: 'shopify_client_secret', encrypted: 'shopify_client_secret_encrypted', changedAt: 'shopify_client_secret_changed_at',
  },
])

function emptyCounts(tenantCount) {
  return {
    tenants: tenantCount,
    plaintext: 0,
    encrypted: 0,
    conflicts: 0,
    corrupt: 0,
    migrationNeeded: 0,
    reEncryptionNeeded: 0,
    migrated: 0,
    reEncrypted: 0,
    plaintextRemaining: 0,
  }
}

export async function migrateIntegrationSecrets(executor, { apply = false } = {}) {
  const config = parseIntegrationSecretsConfig()
  await executor.query('BEGIN')
  try {
    const { rows } = await executor.query(
      `SELECT id,
              mollie_api_key, mollie_api_key_encrypted, mollie_api_key_changed_at,
              shopify_client_secret, shopify_client_secret_encrypted, shopify_client_secret_changed_at
         FROM tenants ORDER BY id FOR UPDATE`,
    )
    const counts = emptyCounts(rows.length)
    const operations = []

    for (const row of rows) {
      for (const credential of CREDENTIALS) {
        const plaintext = row[credential.legacy]
        const envelope = row[credential.encrypted]
        if (plaintext !== null) counts.plaintext += 1
        if (envelope !== null) counts.encrypted += 1
        if (plaintext !== null && envelope !== null) {
          counts.conflicts += 1
          continue
        }
        if (envelope !== null) {
          try {
            const value = decryptIntegrationSecret(envelope, row.id, credential.type, config)
            if (envelope.kid !== config.activeKeyId) {
              counts.reEncryptionNeeded += 1
              operations.push({ kind: 'reencrypt', row, credential, value })
            }
          } catch {
            counts.corrupt += 1
          }
        } else if (plaintext !== null) {
          counts.migrationNeeded += 1
          operations.push({ kind: 'migrate', row, credential, value: plaintext })
        }
      }
    }

    if (counts.conflicts || counts.corrupt) {
      await executor.query('ROLLBACK')
      return { counts, ok: false }
    }

    if (apply) {
      for (const operation of operations) {
        const { row, credential, value, kind } = operation
        const envelope = encryptIntegrationSecret(value, row.id, credential.type, config)
        decryptIntegrationSecret(envelope, row.id, credential.type, config)
        await executor.query(
          `UPDATE tenants
              SET ${credential.encrypted} = $1::jsonb,
                  ${credential.legacy} = NULL,
                  ${credential.changedAt} = ${kind === 'migrate' ? 'COALESCE(' + credential.changedAt + ', NOW())' : credential.changedAt},
                  updated_at = NOW()
            WHERE id = $2`,
          [JSON.stringify(envelope), row.id],
        )
        if (kind === 'migrate') counts.migrated += 1
        else counts.reEncrypted += 1
      }
      const { rows: [remaining] } = await executor.query(
        `SELECT ((COUNT(*) FILTER (WHERE mollie_api_key IS NOT NULL))
                + (COUNT(*) FILTER (WHERE shopify_client_secret IS NOT NULL)))::int AS count
           FROM tenants`,
      )
      counts.plaintextRemaining = remaining.count
      if (counts.plaintextRemaining !== 0) throw new Error('integration_secret_plaintext_remaining')
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
    throw new Error('Usage: npm run migrate:integration-secrets -- --check|--apply')
  }
  const result = await migrateIntegrationSecrets(pool, { apply: args[0] === '--apply' })
  logger.info('integration_secret_migration.completed', { mode: args[0].slice(2), ...result.counts })
  if (!result.ok) process.exitCode = 2
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (err) {
    logger.error('integration_secret_migration.failed', { err })
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
