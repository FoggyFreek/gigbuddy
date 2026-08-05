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
import EventOutlinedIcon from '@mui/icons-material/EventOutlined'
import ContactsOutlinedIcon from '@mui/icons-material/ContactsOutlined'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import type { TutorialCardProps } from '../types.ts'

// Shown once on first arrival in a freshly created artist workspace: what this
// tenant is for, and how it relates to the bands the musician plays in.
export default function PersonalWorkspaceWelcomeCard({ onDismiss, onAccept }: Readonly<TutorialCardProps>) {
  const { t } = useTranslation('tutorials')
  return (
    <Dialog open onClose={onDismiss} maxWidth="sm" fullWidth>
      <DialogTitle>{t($ => $.personalWorkspaceWelcome.title)}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          {t($ => $.personalWorkspaceWelcome.intro)}
        </Typography>
        <List dense>
          <ListItem disableGutters>
            <ListItemIcon sx={{ minWidth: 36 }}><EventOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary={t($ => $.personalWorkspaceWelcome.points.agenda)} />
          </ListItem>
          <ListItem disableGutters>
            <ListItemIcon sx={{ minWidth: 36 }}><ContactsOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary={t($ => $.personalWorkspaceWelcome.points.network)} />
          </ListItem>
          <ListItem disableGutters>
            <ListItemIcon sx={{ minWidth: 36 }}><ReceiptLongOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText
              primary={t($ => $.personalWorkspaceWelcome.points.books)}
              secondary={t($ => $.personalWorkspaceWelcome.points.booksDetail)}
            />
          </ListItem>
          <ListItem disableGutters>
            <ListItemIcon sx={{ minWidth: 36 }}><GroupsOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary={t($ => $.personalWorkspaceWelcome.points.bands)} />
          </ListItem>
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDismiss}>{t($ => $.personalWorkspaceWelcome.maybeLater)}</Button>
        <Button variant="contained" onClick={() => onAccept('/profile')}>
          {t($ => $.personalWorkspaceWelcome.getStarted)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
