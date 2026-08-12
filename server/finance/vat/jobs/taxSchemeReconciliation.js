// Catches the profile's derived `vat_filing_frequency` up with the enrolment
// history. It is written when an enrolment is created or edited, which is not
// enough on its own: an enrolment can be scheduled to start or end on a future
// date, and on that boundary nothing writes anything — the fact changes without
// a request. The date-aware resolver (vatTreatmentService) is the AUTHORITY and
// needs no job; this only keeps the displayed field from lagging.
//
// Idempotent by construction: it recomputes from the enrolment in force today
// and writes only where they disagree, so a second run in the same day is a
// no-op. Called from runReconciliationTick, which already holds a single-instance
// advisory lock.
import { withTransaction } from '../../../db/withTransaction.js'
import { acquireAccountingSettingsLock } from '../../accounts/accountRepository.js'
import { fetchAccountingProfile } from '../../accounting-profile/accountingProfileRepository.js'
import { listProjectionDrift } from '../taxSchemeEnrolmentRepository.js'
import { syncSchemeProjections } from '../taxSchemeEnrolmentService.js'
import { logger } from '../../../utils/logger.js'

// Returns how many tenants were repaired, so the caller (and the tests) can see
// a boundary crossing actually happened.
export async function reconcileSchemeProjections(db) {
  const drifted = await listProjectionDrift(db)
  let repaired = 0

  for (const row of drifted) {
    try {
      // Per tenant, under the same lock every accounting write takes, so a
      // concurrent enrolment change cannot interleave with the repair.
      const changed = await withTransaction(async (client) => {
        await acquireAccountingSettingsLock(client, row.tenant_id)
        const profile = await fetchAccountingProfile(client, row.tenant_id)
        const result = await syncSchemeProjections(client, row.tenant_id, profile)
        return result.changed
      }, { db })

      if (changed) {
        repaired += 1
        logger.info('tax_scheme.projection_reconciled', { tenantId: row.tenant_id })
      }
    } catch (err) {
      // One tenant's failure must never starve the rest of the tick.
      logger.error('tax_scheme.projection_reconcile_failed', { err, tenantId: row.tenant_id })
    }
  }

  return repaired
}
