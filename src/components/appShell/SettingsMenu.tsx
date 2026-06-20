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
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import type { SvgIconComponent } from '@mui/icons-material'

interface NavMenuItemDef {
  to: string
  label: string
  icon: SvgIconComponent
}

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
  onOpenCalendarFeed: () => void
  canManageMembers?: boolean
  canManageTenant?: boolean
  isSuperAdmin?: boolean
}

export default function SettingsMenu({ anchorEl, open, onClose, mode, onToggleTheme, onOpenCalendarFeed, canManageMembers, canManageTenant, isSuperAdmin }: SettingsMenuProps) {
  // Each item is gated on its own capability, not on the tenant_admin role, so
  // the permission matrix stays the single source of truth (see auth/permissions).
  const adminNavItems: NavMenuItemDef[] = [
    canManageMembers && { to: '/members', label: 'Members', icon: GroupIcon },
    canManageTenant && { to: '/settings', label: 'Band Settings', icon: SettingsIcon },
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
        <ListItemText primary={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} />
      </MenuItem>
      <MenuItem onClick={() => { onOpenCalendarFeed(); onClose() }}>
        <ListItemIcon>
          <CalendarMonthIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Subscribe to calendar" />
      </MenuItem>
      {adminNavItems.length > 0 && [
        <Divider key="tenant-admin-divider" />,
        <ListSubheader key="tenant-admin-header" component="div" disableSticky>
          Tenant admin
        </ListSubheader>,
        ...adminNavItems.map((item) => renderNavItem(item, onClose)),
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
