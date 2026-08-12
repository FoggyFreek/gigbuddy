import { useTranslation } from 'react-i18next'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import FinancialProfileFields from './FinancialProfileFields.tsx'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'

// The Settings surface for the band's legal and financial identity — the name,
// address and identifiers printed on its invoices. Section chrome only; the fields
// are reusable so the finance-onboarding wizard can render them without it.
//
// Deliberately separate from AccountingProfileSection: this section is what appears
// on a document, that one is the accounting regime behind it. No field appears in
// both.
export default function FinancialProfileSection() {
  const { t } = useTranslation('settings')
  const compact = useCompactLayout()

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.financialProfile.title)}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t($ => $.financialProfile.description)}
      </Typography>

      <FinancialProfileFields />
    </Paper>
  )
}
