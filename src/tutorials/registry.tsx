import type { TutorialDef } from './types.ts'
import { PERMISSIONS } from '../auth/permissions.ts'
import { FEATURES } from '../auth/entitlements.ts'
import { getFinanceOnboardingStatus } from '../api/financeOnboarding.ts'
import FinanceWelcomeCard from './cards/FinanceWelcomeCard.tsx'

// The ordered tutorial registry — the single place tutorials are declared.
//
// To add a tutorial:
//   1. append a TutorialDef here (choose a stable, never-renamed `key`),
//   2. add its Card under ./cards,
//   3. add its copy under the `tutorials` i18n namespace (en + nl).
// The host shows the first entry that is eligible, not yet dismissed, and whose
// async `condition` (if any) resolves true — so order = priority.
export const TUTORIALS: TutorialDef[] = [
  {
    key: 'finance_welcome',
    // Finance managers on a finance-capable plan, anywhere except the wizard itself.
    eligible: (ctx) =>
      ctx.can(PERMISSIONS.FINANCE_MANAGE)
      && (ctx.hasFeature(FEATURES.FINANCE) || ctx.financeReadOnly)
      && !ctx.pathname.startsWith('/finance-onboarding'),
    // Only while the tenant has no opening balance yet.
    condition: async () => {
      const status = await getFinanceOnboardingStatus()
      return !status.openingBalanceSet
    },
    Card: FinanceWelcomeCard,
  },
]
