import { useTranslation } from 'react-i18next'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import DefaultAccountsFields from './DefaultAccountsFields.tsx'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'

// The Settings surface for accounting defaults: the section chrome (title,
// description) around the reusable DefaultAccountsFields. The wizard's own
// default-accounts step renders DefaultAccountsFields directly, without this
// chrome.
export default function AccountingSettingsSection() {
  const { t } = useTranslation('settings')
  const compact = useCompactLayout()

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3}}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.accounting.title)}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t($ => $.accounting.description)}
      </Typography>

      <DefaultAccountsFields />
    </Paper>
  )
}
