import { useTranslation } from 'react-i18next'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import AccountingProfileFields from './AccountingProfileFields.tsx'
import VatSchemeEnrolments from './VatSchemeEnrolments.tsx'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'

// The Settings surface for the accounting profile: section chrome (title,
// description) around the reusable AccountingProfileFields. Mirrors the
// chrome/fields split of AccountingSettingsSection so the finance-onboarding
// wizard can render the fields without this chrome.
export default function AccountingProfileSection() {
  const { t } = useTranslation('settings')
  const compact = useCompactLayout()

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.accountingProfile.title)}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t($ => $.accountingProfile.description)}
      </Typography>

      <AccountingProfileFields />

      {/* The scheme history sits inside this section rather than beside it:
          "which scheme, since when" qualifies the same regime the fields above
          describe, and the filing period they show is derived from it. */}
      <Divider sx={{ my: 3 }} />
      <VatSchemeEnrolments />
    </Paper>
  )
}
