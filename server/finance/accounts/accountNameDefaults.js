// Re-labelling the seeded chart when a tenant's accounting country changes.
//
// Lives outside accountService.js because that module imports the accounting
// profile service, which is the caller here — a direct import would close a
// cycle.
import { DEFAULT_ACCOUNTS } from '../../db/defaultChartOfAccounts.js'
import { getDefaultAccountName } from '../../domain/accountNamePacks.js'
import { redefaultSystemAccountName } from './accountRepository.js'

// Moves every seeded account onto the new country's labels. Accounts the tenant
// renamed keep their wording; only their default moves, so a later reset lands
// on the new country's label.
export async function redefaultAccountNames(executor, tenantId, countryCode) {
  for (const acc of DEFAULT_ACCOUNTS) {
    const name = getDefaultAccountName(countryCode, acc.code, acc.name)
    await redefaultSystemAccountName(executor, tenantId, acc.code, name)
  }
}
