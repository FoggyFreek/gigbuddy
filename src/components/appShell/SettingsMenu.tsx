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
import GroupIcon from '@mui/icons-material/Group'
import SettingsIcon from '@mui/icons-material/Settings'
import PeopleAltIcon from '@mui/icons-material/PeopleAlt'
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
  canManageMembers?: boolean
  canManageTenant?: boolean
  isSuperAdmin?: boolean
}

export default function SettingsMenu({ anchorEl, open, onClose, mode, onToggleTheme, canManageMembers, canManageTenant, isSuperAdmin }: SettingsMenuProps) {
  const { t, i18n } = useTranslation(['common', 'navigation'])
  const isDutch = i18n.resolvedLanguage === 'nl'
  const toggleLanguage = () => {
    void i18n.changeLanguage(isDutch ? 'en' : 'nl')
    onClose()
  }
  const superAdminNavItems: NavMenuItemDef[] = [
    { to: '/admin/tenants', label: t($ => $.admin.tenants, { ns: 'navigation' }), icon: ApartmentIcon },
    { to: '/admin/users', label: t($ => $.admin.allUsers, { ns: 'navigation' }), icon: PeopleAltIcon },
  ]
  // Each item is gated on its own capability, not on the tenant_admin role, so
  // the permission matrix stays the single source of truth (see auth/permissions).
  const adminNavItems: NavMenuItemDef[] = [
    canManageMembers && { to: '/members', label: t($ => $.admin.members, { ns: 'navigation' }), icon: GroupIcon },
    canManageTenant && { to: '/settings', label: t($ => $.admin.bandSettings, { ns: 'navigation' }), icon: SettingsIcon },
  ].filter((item): item is NavMenuItemDef => Boolean(item))

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
      {adminNavItems.length > 0 && [
        <Divider key="tenant-admin-divider" />,
        <ListSubheader key="tenant-admin-header" component="div" disableSticky>
          {t($ => $.headers.tenantAdmin, { ns: 'navigation' })}
        </ListSubheader>,
        ...adminNavItems.map((item) => renderNavItem(item, onClose)),
      ]}
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
