import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined'
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import type { TutorialCardProps } from '../types.ts'

// The finance welcome tutorial: shown once to finance managers of a tenant with
// no opening balance yet, inviting them into the finance setup wizard.
export default function FinanceWelcomeCard({ onDismiss, onAccept }: Readonly<TutorialCardProps>) {
  const { t } = useTranslation('tutorials')
  return (
    <Dialog open onClose={onDismiss} maxWidth="sm" fullWidth>
      <DialogTitle>{t($ => $.financeWelcome.title)}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t($ => $.financeWelcome.intro)}
        </Typography>
        <List dense>
          <ListItem disableGutters>
            <ListItemIcon sx={{ minWidth: 36 }}><AccountBalanceOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary={t($ => $.financeWelcome.points.openingBalance)} />
          </ListItem>
          <ListItem disableGutters>
            <ListItemIcon sx={{ minWidth: 36 }}><BadgeOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary={t($ => $.financeWelcome.points.profile)} />
          </ListItem>
          <ListItem disableGutters>
            <ListItemIcon sx={{ minWidth: 36 }}><AccountTreeOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary={t($ => $.financeWelcome.points.accounts)} />
          </ListItem>
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDismiss}>{t($ => $.financeWelcome.maybeLater)}</Button>
        <Button variant="contained" onClick={() => onAccept('/finance-onboarding')}>
          {t($ => $.financeWelcome.getStarted)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
