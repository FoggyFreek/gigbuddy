import { NavLink } from 'react-router-dom'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
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

const TENANT_ADMIN_NAV_ITEMS: NavMenuItemDef[] = [
  { to: '/members', label: 'Members', icon: GroupIcon },
  { to: '/settings', label: 'Band Settings', icon: SettingsIcon },
]

const SUPER_ADMIN_NAV_ITEMS: NavMenuItemDef[] = [
  { to: '/admin/tenants', label: 'Tenants', icon: ApartmentIcon },
  { to: '/admin/users', label: 'All Users', icon: PeopleAltIcon },
]

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
  isTenantAdmin?: boolean
  isSuperAdmin?: boolean
}

export default function SettingsMenu({ anchorEl, open, onClose, mode, onToggleTheme, isTenantAdmin, isSuperAdmin }: SettingsMenuProps) {
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
        <ListItemText primary={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} />
      </MenuItem>
      {isTenantAdmin && [
        <Divider key="tenant-admin-divider" />,
        <ListSubheader key="tenant-admin-header" component="div" disableSticky>
          Tenant admin
        </ListSubheader>,
        ...TENANT_ADMIN_NAV_ITEMS.map((item) => renderNavItem(item, onClose)),
      ]}
      {isSuperAdmin && [
        <Divider key="super-admin-divider" />,
        <ListSubheader key="super-admin-header" component="div" disableSticky>
          Super admin
        </ListSubheader>,
        ...SUPER_ADMIN_NAV_ITEMS.map((item) => renderNavItem(item, onClose)),
      ]}
    </Menu>
  )
}
