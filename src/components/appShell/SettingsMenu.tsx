import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import TranslateIcon from '@mui/icons-material/Translate'
import SettingsIcon from '@mui/icons-material/Settings'
import type { SvgIconComponent } from '@mui/icons-material'

interface NavMenuItemDef {
  to: string
  label: string
  icon: SvgIconComponent
}

function renderNavItem(item: NavMenuItemDef, onClose: () => void) {
  const Icon = item.icon
  return (
    <MenuItem key={item.to} component={NavLink} to={item.to} onClick={onClose}>
      <ListItemIcon>
        <Icon fontSize="small" />
      </ListItemIcon>
      <ListItemText primary={item.label} />
    </MenuItem>
  )
}

interface SettingsMenuProps {
  anchorEl?: Element | null
  open: boolean
  onClose: () => void
  mode: string
  onToggleTheme: () => void
}

export default function SettingsMenu({ anchorEl, open, onClose, mode, onToggleTheme }: Readonly<SettingsMenuProps>) {
  const { t, i18n } = useTranslation(['common', 'navigation'])
  const isDutch = i18n.resolvedLanguage === 'nl'
  const toggleLanguage = () => {
    void i18n.changeLanguage(isDutch ? 'en' : 'nl')
    onClose()
  }
  // The unified settings page is reachable by every member; each section gates
  // its own content by role, so this entry is not permission-gated.
  const settingsNavItem: NavMenuItemDef = {
    to: '/settings',
    label: t($ => $.shell.settings, { ns: 'navigation' }),
    icon: SettingsIcon,
  }

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <MenuItem onClick={onToggleTheme}>
        <ListItemIcon>
          {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
        </ListItemIcon>
        <ListItemText primary={mode === 'dark' ? t($ => $.appearance.switchToLight) : t($ => $.appearance.switchToDark)} />
      </MenuItem>
      <MenuItem onClick={toggleLanguage}>
        <ListItemIcon>
          <TranslateIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={isDutch ? t($ => $.language.switchToEnglish) : t($ => $.language.switchToDutch)} />
      </MenuItem>
      <Divider />
      {renderNavItem(settingsNavItem, onClose)}
    </Menu>
  )
}
