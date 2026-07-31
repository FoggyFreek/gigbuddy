import 'dotenv/config'
import pool from '../db/index.js'
import {
  applyVatTaxFactBackfill,
  listVatTaxFactBackfillTenantIds,
  previewVatTaxFactBackfill,
} from '../services/vatTaxFactBackfillService.js'

const apply = process.argv.includes('--apply')
const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='))
const tenantId = tenantArg ? Number(tenantArg.slice('--tenant='.length)) : null

if (tenantArg && (!Number.isInteger(tenantId) || tenantId <= 0)) {
  console.error('Invalid --tenant value')
  process.exitCode = 1
} else {
  const tenantIds = tenantId == null
    ? await listVatTaxFactBackfillTenantIds(pool)
    : [tenantId]
  const results = []
  for (const currentTenantId of tenantIds) {
    const result = apply
      ? await applyVatTaxFactBackfill(pool, currentTenantId)
      : await previewVatTaxFactBackfill(pool, currentTenantId)
    if (result.error) {
      console.error(JSON.stringify({
        tenant_id: currentTenantId,
        error: result.error.body.error,
      }))
      process.exitCode = 1
      continue
    }
    results.push(result.backfill)
    console.log(JSON.stringify(result.backfill))
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'check',
    transactions_requiring_review: results.reduce(
      (sum, result) => sum + result.transactions_found,
      0,
    ),
    inserted: results.reduce((sum, result) => sum + result.inserted, 0),
    affected_tenants: results.length,
    tenant_id: tenantId,
  }))
}

await pool.end()
