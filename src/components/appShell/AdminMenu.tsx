import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined'
import PeopleAltOutlined from '@mui/icons-material/PeopleAltOutlined'
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined'
import ViewListOutlined from '@mui/icons-material/ViewListOutlined'
import PercentOutlined from '@mui/icons-material/PercentOutlined'
import CardGiftcardOutlined from '@mui/icons-material/CardGiftcardOutlined'
import MonitorHeartOutlined from '@mui/icons-material/MonitorHeartOutlined'
import type { SvgIconComponent } from '@mui/icons-material'

interface AdminMenuProps {
  anchorEl?: Element | null
  open: boolean
  onClose: () => void
}

interface AdminMenuItem {
  to: string
  label: string
  icon: SvgIconComponent
}

function menuItem(item: AdminMenuItem, onClose: () => void) {
  const Icon = item.icon
  return (
    <MenuItem key={item.to} component={NavLink} to={item.to} onClick={onClose}>
      <ListItemIcon><Icon fontSize="small" /></ListItemIcon>
      <ListItemText primary={item.label} />
    </MenuItem>
  )
}

export default function AdminMenu({ anchorEl, open, onClose }: Readonly<AdminMenuProps>) {
  const { t } = useTranslation('navigation')
  const operations: AdminMenuItem[] = [
    { to: '/admin/operations', label: t($ => $.admin.operations), icon: MonitorHeartOutlined },
  ]
  const management: AdminMenuItem[] = [
    { to: '/admin/tenants', label: t($ => $.admin.tenants), icon: ApartmentOutlined },
    { to: '/admin/users', label: t($ => $.admin.allUsers), icon: PeopleAltOutlined },
    { to: '/admin/band-profile-claims', label: t($ => $.admin.bandProfileClaims), icon: VerifiedOutlined },
  ]
  const billing: AdminMenuItem[] = [
    { to: '/admin/plan-catalog', label: t($ => $.admin.planCatalog), icon: ViewListOutlined },
    { to: '/admin/pricing-rules', label: t($ => $.admin.pricingRules), icon: PercentOutlined },
    { to: '/admin/complimentary-access', label: t($ => $.admin.complimentaryAccess), icon: CardGiftcardOutlined },
  ]

  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      <ListSubheader component="div" disableSticky>{t($ => $.adminSections.operations)}</ListSubheader>
      {operations.map((item) => menuItem(item, onClose))}
      <ListSubheader component="div" disableSticky>{t($ => $.adminSections.management)}</ListSubheader>
      {management.map((item) => menuItem(item, onClose))}
      <ListSubheader component="div" disableSticky>{t($ => $.adminSections.billing)}</ListSubheader>
      {billing.map((item) => menuItem(item, onClose))}
    </Menu>
  )
}
