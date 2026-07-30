// Consistency audit + repair for the VAT scheme enrolments (migration 140) and
// the issued-document treatment snapshots (migration 141).
//
// Exit codes distinguish two ESSENTIALLY different things, because conflating
// them would mean --check never becomes clean:
//
//   BLOCKING (exit 2)  Repairable faults that must reach zero: an issued
//                      document with no snapshot, overlapping enrolments, a
//                      legacy projection disagreeing with the enrolment in
//                      force today. --apply fixes what it can.
//
//   FINDINGS (exit 0)  Things a human must look at and NO script may decide:
//                      a snapshot the migration inferred but nobody confirmed,
//                      an invoice whose stored VAT contradicts its treatment, a
//                      recorded-but-inert scheme, the known input-VAT posting
//                      divergence. --strict promotes these to blocking for a
//                      caller that wants a hard gate.
//
// The evidence conflicts are never auto-repaired: the ledger already posted
// whatever tax_cents says, so which of the two is wrong is a judgement about the
// real document, and the remedy is a correction document rather than an UPDATE.
//
// --check  reports, writes nothing.
// --apply  fills missing snapshots and repairs drifted projections.
// --strict makes findings blocking too.
import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import pool from '../db/index.js'
import { logger } from '../utils/logger.js'
import {
  listIssuedInvoicesMissingSnapshot,
  listInvoiceSnapshotConflicts,
  countInferredInvoiceSnapshots,
  countUnimplementedSchemeInvoices,
  setInvoiceVatSnapshot,
} from '../repositories/invoiceRepository.js'
import {
  listPostedPurchasesMissingSnapshot,
  listPurchaseInputVatDivergence,
  countInferredPurchaseSnapshots,
  setPurchaseVatSnapshot,
} from '../repositories/purchaseRepository.js'
import {
  listOverlappingEnrolments,
  listProjectionDrift,
} from '../repositories/taxSchemeEnrolmentRepository.js'
import {
  resolveLiveTreatment,
  taxPointDate,
  invoiceSnapshotColumns,
  purchaseSnapshotColumns,
} from '../services/vatTreatmentService.js'
import { ZERO_RATING_SCHEME_CODES } from '../services/taxSchemeEnrolmentService.js'
import { reconcileSchemeProjections } from '../jobs/taxSchemeReconciliation.js'
import { TAX_SCHEMES } from '../../shared/taxSchemes.js'

const IMPLEMENTED_SCHEME_CODES = Object.entries(TAX_SCHEMES)
  .filter(([, s]) => s.implemented)
  .map(([code]) => code)

// Repairs a deploy-window document by resolving it live. NOT the migration's
// evidence-first inference, and deliberately so: these are documents the previous
// container issued minutes ago under the configuration that is still current, so
// the enrolment covering their tax point IS the right answer. If the resulting
// treatment contradicts the stored VAT, the conflict report picks it up on the
// next pass rather than this script silently choosing a side.
async function repairInvoice(executor, invoice) {
  const treatment = await resolveLiveTreatment(executor, invoice.tenant_id, taxPointDate(invoice), {
    reverseCharge: Boolean(invoice.reverse_charge),
  })
  if (!treatment) return false
  await setInvoiceVatSnapshot(executor, invoice.id, {
    ...invoiceSnapshotColumns(treatment),
    vat_snapshot_source: 'legacy_inferred',
  })
  return true
}

async function repairPurchase(executor, purchase) {
  const treatment = await resolveLiveTreatment(executor, purchase.tenant_id, purchase.receipt_date)
  if (!treatment) return false
  await setPurchaseVatSnapshot(executor, purchase.id, {
    ...purchaseSnapshotColumns(treatment),
    vat_snapshot_source: 'legacy_inferred',
  })
  return true
}

export async function auditVatSchemeSnapshots(executor, { apply = false, strict = false } = {}) {
  const missingInvoices = await listIssuedInvoicesMissingSnapshot(executor)
  const missingPurchases = await listPostedPurchasesMissingSnapshot(executor)
  const overlaps = await listOverlappingEnrolments(executor)
  const drift = await listProjectionDrift(executor, [...ZERO_RATING_SCHEME_CODES])

  const conflicts = await listInvoiceSnapshotConflicts(executor)
  const inputVatDivergence = await listPurchaseInputVatDivergence(executor)
  const inferredInvoices = await countInferredInvoiceSnapshots(executor)
  const inferredPurchases = await countInferredPurchaseSnapshots(executor)
  const unimplementedScheme = await countUnimplementedSchemeInvoices(executor, IMPLEMENTED_SCHEME_CODES)

  const counts = {
    missingInvoiceSnapshots: missingInvoices.length,
    missingPurchaseSnapshots: missingPurchases.length,
    overlappingEnrolments: overlaps.length,
    projectionDrift: drift.length,
    repairedInvoices: 0,
    repairedPurchases: 0,
    repairedProjections: 0,
    // Findings.
    invoiceEvidenceConflicts: conflicts.length,
    inputVatPostingDivergence: inputVatDivergence.length,
    inferredInvoiceSnapshots: inferredInvoices,
    inferredPurchaseSnapshots: inferredPurchases,
    unimplementedSchemeInvoices: unimplementedScheme,
  }

  if (apply) {
    for (const invoice of missingInvoices) {
      if (await repairInvoice(executor, invoice)) counts.repairedInvoices += 1
    }
    for (const purchase of missingPurchases) {
      if (await repairPurchase(executor, purchase)) counts.repairedPurchases += 1
    }
    counts.repairedProjections = await reconcileSchemeProjections(executor)
  }

  // Overlaps are never auto-repaired — which of two ranges is wrong is a human
  // call — so they fail in both modes. Missing snapshots and drift only fail in
  // --check, since --apply just fixed them.
  const blocking = overlaps.length > 0
    || (!apply && (missingInvoices.length > 0 || missingPurchases.length > 0 || drift.length > 0))
  const findings = conflicts.length > 0 || inputVatDivergence.length > 0
    || inferredInvoices > 0 || inferredPurchases > 0

  return {
    counts,
    ok: !blocking && !(strict && findings),
    blocking,
    findings,
    missingInvoices,
    missingPurchases,
    overlaps,
    drift,
    conflicts,
    inputVatDivergence,
  }
}

function reportDetails(result) {
  for (const row of result.missingInvoices) {
    logger.error('vat_snapshot_audit.missing', {
      tenantId: row.tenant_id, invoiceId: row.id, operation: 'missing_invoice_snapshot',
    })
  }
  for (const row of result.missingPurchases) {
    logger.error('vat_snapshot_audit.missing', {
      tenantId: row.tenant_id, purchaseId: row.id, operation: 'missing_purchase_snapshot',
    })
  }
  for (const row of result.overlaps) {
    logger.error('vat_snapshot_audit.overlap', {
      tenantId: row.tenant_id, operation: 'overlapping_enrolment',
    })
  }
  for (const row of result.drift) {
    logger.error('vat_snapshot_audit.drift', {
      tenantId: row.tenant_id, operation: 'projection_drift',
    })
  }
  // Findings — warn, never error: these need a human, not a fix.
  for (const row of result.conflicts) {
    logger.warn('vat_snapshot_audit.evidence_conflict', {
      tenantId: row.tenant_id, invoiceId: row.id, operation: 'tax_cents_vs_treatment',
    })
  }
  for (const row of result.inputVatDivergence) {
    logger.warn('vat_snapshot_audit.input_vat_divergence', {
      tenantId: row.tenant_id, purchaseId: row.id, operation: 'non_recoverable_but_deducted',
    })
  }
}

async function main() {
  const args = process.argv.slice(2)
  const mode = args.find((a) => a === '--check' || a === '--apply')
  const strict = args.includes('--strict')
  if (!mode || args.some((a) => !['--check', '--apply', '--strict'].includes(a))) {
    throw new Error('Usage: node server/scripts/auditVatSchemeSnapshots.js --check|--apply [--strict]')
  }
  const result = await auditVatSchemeSnapshots(pool, { apply: mode === '--apply', strict })
  reportDetails(result)
  logger.info('vat_snapshot_audit.completed', { mode: mode.slice(2), ...result.counts })
  if (!result.ok) process.exitCode = 2
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (err) {
    logger.error('vat_snapshot_audit.failed', { err })
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
