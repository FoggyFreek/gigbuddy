import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import TranslateIcon from '@mui/icons-material/Translate'
import ApartmentIcon from '@mui/icons-material/Apartment'
import SettingsIcon from '@mui/icons-material/Settings'
import PeopleAltIcon from '@mui/icons-material/PeopleAlt'
import CreditCardIcon from '@mui/icons-material/CreditCard'
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
  isSuperAdmin?: boolean
}

export default function SettingsMenu({ anchorEl, open, onClose, mode, onToggleTheme, isSuperAdmin }: Readonly<SettingsMenuProps>) {
  const { t, i18n } = useTranslation(['common', 'navigation'])
  const isDutch = i18n.resolvedLanguage === 'nl'
  const toggleLanguage = () => {
    void i18n.changeLanguage(isDutch ? 'en' : 'nl')
    onClose()
  }
  const superAdminNavItems: NavMenuItemDef[] = [
    { to: '/admin/tenants', label: t($ => $.admin.tenants, { ns: 'navigation' }), icon: ApartmentIcon },
    { to: '/admin/users', label: t($ => $.admin.allUsers, { ns: 'navigation' }), icon: PeopleAltIcon },
    // Hardcoded English (billing copy is not localized yet, per the rollout plan).
    { to: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCardIcon },
  ]
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
      {isSuperAdmin && [
        <Divider key="super-admin-divider" />,
        <ListSubheader key="super-admin-header" component="div" disableSticky>
          {t($ => $.headers.superAdmin, { ns: 'navigation' })}
        </ListSubheader>,
        ...superAdminNavItems.map((item) => renderNavItem(item, onClose)),
      ]}
    </Menu>
  )
}
