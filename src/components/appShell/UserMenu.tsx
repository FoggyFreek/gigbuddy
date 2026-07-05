import { NavLink } from 'react-router-dom'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import CheckIcon from '@mui/icons-material/Check'
import LogoutIcon from '@mui/icons-material/Logout'
import type { Id } from '../../types/entities.ts'

interface ApprovedMembership {
  tenantId: Id
  tenantName?: string
  role?: string
}

interface UserMenuProps {
  anchorEl?: Element | null
  open: boolean
  onClose: () => void
  approvedMemberships: ApprovedMembership[]
  activeTenantId?: Id
  onSwitch: (tenantId: Id) => void
  onLogout: () => void
}

export default function UserMenu({
  anchorEl, open, onClose, approvedMemberships, activeTenantId, onSwitch, onLogout,
}: Readonly<UserMenuProps>) {
  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      {approvedMemberships.length > 1 && [
        <ListSubheader key="hdr" component="div" disableSticky>
          Switch band
        </ListSubheader>,
        ...approvedMemberships.map((m) => (
          <MenuItem
            key={String(m.tenantId)}
            selected={m.tenantId === activeTenantId}
            onClick={() => onSwitch(m.tenantId)}
          >
            <ListItemIcon>
              {m.tenantId === activeTenantId ? <CheckIcon fontSize="small" /> : null}
            </ListItemIcon>
            <ListItemText
              primary={m.tenantName}
              secondary={m.role === 'tenant_admin' ? 'admin' : null}
            />
          </MenuItem>
        )),
        <Divider key="div" />,
      ]}
      <MenuItem onClick={onLogout}>
        <ListItemIcon>
          <LogoutIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary="Log out" />
      </MenuItem>
    </Menu>
  )
}
