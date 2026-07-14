import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import TipsAndUpdatesOutlinedIcon from '@mui/icons-material/TipsAndUpdatesOutlined'
import DefaultAccountsFields from './DefaultAccountsFields.tsx'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'

// The Settings surface for accounting defaults: the section chrome (title,
// description, launch-the-wizard button) around the reusable DefaultAccountsFields.
// The wizard's own default-accounts step renders DefaultAccountsFields directly,
// without this chrome.
export default function AccountingSettingsSection() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
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

      <Button
        variant="outlined"
        size="small"
        startIcon={<TipsAndUpdatesOutlinedIcon />}
        onClick={() => navigate('/finance-onboarding')}
        sx={{ mb: 2 }}
      >
        {t($ => $.accounting.wizard.cta)}
      </Button>

      <DefaultAccountsFields />
    </Paper>
  )
}
