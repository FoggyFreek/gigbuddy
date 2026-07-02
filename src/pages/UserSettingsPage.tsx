import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined'
import NotificationSettingsSection from '../components/account/NotificationSettingsSection.tsx'
import ThemeSettingsSection from '../components/account/ThemeSettingsSection.tsx'

// Per-user (cross-tenant) settings, as opposed to /settings which is the
// tenant-admin band configuration. Sections are addressed by route param so
// the bell's settings shortcut can deep-link to /account/notifications.
const SECTIONS = ['notifications', 'theme'] as const
type Section = (typeof SECTIONS)[number]

export default function UserSettingsPage() {
  const { t } = useTranslation('notifications')
  const navigate = useNavigate()
  const { section } = useParams()
  const activeSection: Section = SECTIONS.includes(section as Section)
    ? (section as Section)
    : 'notifications'

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>{t($ => $.settings.title)}</Typography>
      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
        <Paper elevation={0} sx={{ width: { xs: '100%', md: 220 }, flexShrink: 0, alignSelf: 'flex-start' }}>
          <List dense>
            <ListItemButton
              selected={activeSection === 'notifications'}
              onClick={() => navigate('/account/notifications')}
            >
              <ListItemIcon><NotificationsNoneIcon /></ListItemIcon>
              <ListItemText primary={t($ => $.settings.sections.notifications)} />
            </ListItemButton>
            <ListItemButton
              selected={activeSection === 'theme'}
              onClick={() => navigate('/account/theme')}
            >
              <ListItemIcon><PaletteOutlinedIcon /></ListItemIcon>
              <ListItemText primary={t($ => $.settings.sections.theme)} />
            </ListItemButton>
          </List>
        </Paper>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          {activeSection === 'notifications' && <NotificationSettingsSection />}
          {activeSection === 'theme' && <ThemeSettingsSection />}
        </Box>
      </Box>
    </Box>
  )
}
