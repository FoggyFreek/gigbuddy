import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import CheckIcon from '@mui/icons-material/Check'
import LogoutIcon from '@mui/icons-material/Logout'
import PersonOutlined from '@mui/icons-material/PersonOutlined'
import PersonAddAltOutlined from '@mui/icons-material/PersonAddAltOutlined'
import type { Id } from '../../types/entities.ts'
import type { TenantKind } from '../../utils/businessRegistry.ts'

interface ApprovedMembership {
  tenantId: Id
  tenantName?: string
  kind?: TenantKind
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
  /** Absent while creating one isn't offered (already owns one, or onboarding is off). */
  onCreatePersonalWorkspace?: () => void
}

export default function UserMenu({
  anchorEl, open, onClose, approvedMemberships, activeTenantId, onSwitch, onLogout,
  onCreatePersonalWorkspace,
}: Readonly<UserMenuProps>) {
  const { t } = useTranslation('navigation')
  // Nothing to switch between with a single tenant — the menu stays just "log out".
  const canSwitch = approvedMemberships.length > 1
  const personal = canSwitch ? approvedMemberships.find((m) => m.kind === 'personal') : undefined
  const bands = canSwitch ? approvedMemberships.filter((m) => m.kind !== 'personal') : []

  const membershipItem = (m: ApprovedMembership, icon?: ReactNode) => (
    <MenuItem
      key={String(m.tenantId)}
      selected={m.tenantId === activeTenantId}
      onClick={() => onSwitch(m.tenantId)}
    >
      <ListItemIcon>
        {m.tenantId === activeTenantId ? <CheckIcon fontSize="small" /> : icon}
      </ListItemIcon>
      <ListItemText
        primary={m.tenantName}
        secondary={m.role === 'tenant_admin' ? t($ => $.userMenu.admin) : null}
      />
    </MenuItem>
  )

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      {/* The musician's own workspace is pinned above their bands, with a person
          icon rather than a band logo, so "me" reads as a different kind of row. */}
      {personal && [
        <ListSubheader key="me-hdr" component="div" disableSticky>
          {t($ => $.userMenu.me)}
        </ListSubheader>,
        membershipItem(personal, <PersonOutlined fontSize="small" />),
        <Divider key="me-div" />,
      ]}
      {!approvedMemberships.some((m) => m.kind === 'personal') && onCreatePersonalWorkspace && [
        <MenuItem key="create-personal" onClick={onCreatePersonalWorkspace}>
          <ListItemIcon>
            <PersonAddAltOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t($ => $.userMenu.createPersonalWorkspace)} />
        </MenuItem>,
        <Divider key="create-personal-div" />,
      ]}
      {bands.length > 0 && [
        <ListSubheader key="hdr" component="div" disableSticky>
          {t($ => $.userMenu.switchBand)}
        </ListSubheader>,
        ...bands.map((m) => membershipItem(m)),
        <Divider key="div" />,
      ]}
      <MenuItem onClick={onLogout}>
        <ListItemIcon>
          <LogoutIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={t($ => $.userMenu.logout)} />
      </MenuItem>
    </Menu>
  )
}
