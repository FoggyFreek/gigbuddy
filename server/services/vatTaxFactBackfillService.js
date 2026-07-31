import { abortTransaction, withTransaction } from '../db/withTransaction.js'
import { fetchTenant } from '../repositories/tenantRepository.js'
import {
  acquireVatTaxFactBackfillLock,
  assignTaxFactToLegacyReturn,
  insertLedgerTaxFacts,
  listLegacyVatTransactions,
  listLegacyVatTenantIds,
} from '../repositories/taxFactRepository.js'
import { notFound } from './serviceErrors.js'

const LOG_DETAIL_LIMIT = 100

function legacyFact(row) {
  const output = Number(row.output_vat_cents)
  const input = Number(row.input_vat_cents)
  return {
    source_line_kind: 'legacy_transaction',
    tax_point: row.entry_date,
    direction: input !== 0 ? 'purchase' : 'sale',
    tax_jurisdiction_code: row.country_code,
    category_code: 'legacy_unclassified',
    category_version: `${row.country_code}-tax-categories-legacy`,
    treatment: 'standard',
    rate: 0,
    recovery_percent: input !== 0 ? 100 : 0,
    taxable_base_cents: 0,
    tax_amount_cents: Math.max(Math.abs(output), Math.abs(input)),
    output_vat_cents: output,
    deductible_input_vat_cents: input,
    non_deductible_input_vat_cents: 0,
    classification_status: 'unclassified',
  }
}

function transactionLogs(rows, mode) {
  const action = mode === 'apply' ? 'created' : 'will be created'
  return rows.slice(0, LOG_DETAIL_LIMIT).map((row) => ({
    level: 'warning',
    message: `Transaction ${row.transaction_id} (${row.entry_date}, ${row.source_type} `
      + `${row.source_id}/${row.source_event}) ${action} as legacy_unclassified `
      + `(output VAT ${row.output_vat_cents} cents, input VAT ${row.input_vat_cents} cents).`,
  }))
}

function resultFor({ mode, tenantId, rows, inserted = 0, assigned = 0, remaining }) {
  const logs = [{
    level: rows.length ? 'info' : 'success',
    message: rows.length
      ? `Found ${rows.length} ledger transactions requiring VAT classification.`
      : 'No ledger transactions require VAT tax-fact backfill.',
  }]
  logs.push(...transactionLogs(rows, mode))
  if (mode === 'apply') {
    logs.push({
      level: 'success',
      message: `Inserted ${inserted} legacy VAT tax ${inserted === 1 ? 'fact' : 'facts'}.`,
    })
    logs.push({
      level: 'info',
      message: `Assigned ${assigned} ${assigned === 1 ? 'fact' : 'facts'} to existing submitted VAT returns.`,
    })
  }
  if (rows.length > LOG_DETAIL_LIMIT) {
    logs.push({
      level: 'warning',
      message: `${rows.length - LOG_DETAIL_LIMIT} transaction log entries were omitted from this response.`,
    })
  }

  return {
    mode,
    tenant_id: tenantId,
    transactions_found: rows.length,
    inserted,
    assigned_to_submitted_returns: assigned,
    remaining,
    logs_truncated: rows.length > LOG_DETAIL_LIMIT,
    logs,
  }
}

async function ensureTenant(executor, tenantId) {
  return Boolean(await fetchTenant(executor, tenantId))
}

export async function previewVatTaxFactBackfill(db, tenantId) {
  if (!(await ensureTenant(db, tenantId))) return notFound('Tenant not found')
  const rows = await listLegacyVatTransactions(db, tenantId)
  return {
    backfill: resultFor({
      mode: 'preview',
      tenantId,
      rows,
      remaining: rows.length,
    }),
    audit: {
      action: 'tenant.vat_tax_facts_backfill.preview',
      details: { tenantId, affectedCount: rows.length },
    },
  }
}

export async function applyVatTaxFactBackfill(db, tenantId) {
  const transactionResult = await withTransaction(async (client) => {
    await acquireVatTaxFactBackfillLock(client, tenantId)
    if (!(await ensureTenant(client, tenantId))) {
      abortTransaction(notFound('Tenant not found'))
    }
    const rows = await listLegacyVatTransactions(client, tenantId)
    let assigned = 0

    for (const row of rows) {
      const [fact] = await insertLedgerTaxFacts(
        client,
        tenantId,
        row.transaction_id,
        [legacyFact(row)],
      )
      if (await assignTaxFactToLegacyReturn(client, tenantId, fact.id, row.entry_date)) {
        assigned += 1
      }
    }

    const remaining = (await listLegacyVatTransactions(client, tenantId)).length
    return resultFor({
      mode: 'apply',
      tenantId,
      rows,
      inserted: rows.length,
      assigned,
      remaining,
    })
  }, { db })
  if (transactionResult.error) return transactionResult
  const backfill = transactionResult

  return {
    backfill,
    audit: {
      action: 'tenant.vat_tax_facts_backfill.apply',
      details: { tenantId, affectedCount: backfill.inserted },
    },
  }
}

export async function listVatTaxFactBackfillTenantIds(db) {
  return listLegacyVatTenantIds(db)
}
