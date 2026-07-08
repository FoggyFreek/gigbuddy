import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import { useEntitlements } from '../hooks/useEntitlements.ts'

// Shown on finance surfaces when the active tenant's plan lacks the finance
// feature but finance data exists: reads and exports stay available (the band's
// records are theirs), but every write is blocked server-side. This banner tells
// the user why their edit buttons 403.
export default function FinanceReadOnlyBanner() {
  const { t } = useTranslation('billing')
  const { financeReadOnly } = useEntitlements()
  if (!financeReadOnly) return null
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      {t($ => $.financeReadOnly)}
    </Alert>
  )
}
