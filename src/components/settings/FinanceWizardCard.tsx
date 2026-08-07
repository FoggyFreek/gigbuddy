import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import TipsAndUpdatesOutlinedIcon from '@mui/icons-material/TipsAndUpdatesOutlined'

// Entry point to the finance setup wizard, shown atop the settings page for
// anyone who may manage finance. The wizard spans several settings sections
// (opening balance, financial profile, default accounts), so it sits above the
// nav rather than inside one of them.
export default function FinanceWizardCard() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <TipsAndUpdatesOutlinedIcon color="primary" />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.financeWizard.title)}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          {t($ => $.financeWizard.help)}
        </Typography>
      </Box>
      <Button size="small" variant="outlined" onClick={() => navigate('/finance-onboarding')}>
        {t($ => $.financeWizard.cta)}
      </Button>
    </Paper>
  )
}
