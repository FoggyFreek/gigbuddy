import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import ListSubheader from '@mui/material/ListSubheader'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import type { SvgIconComponent } from '@mui/icons-material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import TuneIcon from '@mui/icons-material/Tune'
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined'
import PersonIcon  from '@mui/icons-material/Person'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined'
import GroupIcon from '@mui/icons-material/Group'
import StorageIcon from '@mui/icons-material/Storage'
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined'
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined'
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined'
import GroupsIcon from '@mui/icons-material/Groups'
import { usePermissions } from '../../hooks/usePermissions.ts'
import { useAuth } from '../../contexts/authContext.ts'
import { PERMISSIONS, type Permission } from '../../auth/permissions.ts'
import SubscriptionSummaryCard from './components/settings/SubscriptionSummaryCard.tsx'
import FinanceWizardCard from './components/settings/FinanceWizardCard.tsx'
import NotificationSettingsSection from '../../finance/accounts/components/NotificationSettingsSection.tsx'
import ThemeSettingsSection from '../../finance/accounts/components/ThemeSettingsSection.tsx'
import BillingSettingsSection from '../../finance/accounts/components/BillingSettingsSection.tsx'
import ConnectedAccountsSection from '../../finance/accounts/components/ConnectedAccountsSection.tsx'
import AccentColorSection from './components/settings/AccentColorSection.tsx'
import StorageUsageSection from './components/settings/StorageUsageSection.tsx'
import IntegrationsSection from './components/settings/IntegrationsSection.tsx'
import MembersSection from './components/settings/MembersSection.tsx'
import ChartOfAccountsSection from './components/settings/ChartOfAccountsSection.tsx'
import AccountingSettingsSection from './components/settings/AccountingSettingsSection.tsx'
import AccountingProfileSection from './components/settings/AccountingProfileSection.tsx'
import FinancialProfileSection from './components/settings/FinancialProfileSection.tsx'
import BandProfileClaimSection from './components/settings/BandProfileClaimSection.tsx'
import MyAvailabilitySection from './components/settings/MyAvailabilitySection.tsx'
import DiscoverabilitySection from './components/settings/DiscoverabilitySection.tsx'
import TenantDeletionSection from './components/settings/TenantDeletionSection.tsx'
import TenantSlugSection from './components/settings/TenantSlugSection.tsx'
import InvitesSection from '../memberships/components/InvitesSection.tsx'
import { useTenantKind } from '../../hooks/useTenantKind.ts'
import { useEntitlements } from '../../hooks/useEntitlements.ts'
import { FEATURES } from '../../auth/entitlements.ts'
import { TENANT_CAPABILITIES, type TenantCapability } from '../../auth/tenantCapabilities.ts'

// A single settings surface that merges the former per-user account settings,
// members management, and tenant (band) settings. Desktop uses a master-detail
// layout (nav card + detail pane); mobile drills into each section separately
// with a back arrow. The nav is role-gated: band and finance items appear only
// when the active tenant role grants the matching permission.
type SectionId =
  | 'preferences' | 'billing' | 'connected-accounts' | 'my-availability'
  | 'accent' | 'members' | 'storage'
  | 'integrations' | 'chart-of-accounts' | 'default-accounts'
  | 'financial-profile' | 'accounting-profile' | 'delete-account'

// camelCase leaf keys under settings.nav.items — a literal union so the typed
// selector index (`t($ => $.nav.items[labelKey])`) stays compile-checked.
type ItemLabelKey =
  | 'preferences' | 'billing' | 'connectedAccounts' | 'myAvailability' | 'accent' | 'membersAndInvites'
  | 'storage' | 'integrations' | 'chartOfAccounts' | 'defaultAccounts'
  | 'financialProfile' | 'accountingProfile' | 'manageAccounts'

interface NavItemDef {
  id: SectionId
  labelKey: ItemLabelKey
  icon: SvgIconComponent
  // Required tenant permission; undefined = available to every member.
  permission?: Permission
  // Named kind capability; undefined = kind-neutral.
  capability?: TenantCapability
}

const ACCOUNT_ITEMS: NavItemDef[] = [
  { id: 'preferences', labelKey: 'preferences', icon: TuneIcon },
  { id: 'my-availability', labelKey: 'myAvailability', icon: EventAvailableOutlinedIcon },
  { id: 'connected-accounts', labelKey: 'connectedAccounts', icon: PersonIcon  },
  { id: 'billing', labelKey: 'billing', icon: CreditCardOutlinedIcon },
]

const BAND_ITEMS: NavItemDef[] = [
  { id: 'accent', labelKey: 'accent', icon: PaletteOutlinedIcon, permission: PERMISSIONS.TENANT_MANAGE },
  { id: 'members', labelKey: 'membersAndInvites', icon: GroupIcon, permission: PERMISSIONS.MEMBERS_MANAGE, capability: TENANT_CAPABILITIES.BAND_MEMBERSHIP_ADMIN },
  { id: 'storage', labelKey: 'storage', icon: StorageIcon, permission: PERMISSIONS.TENANT_MANAGE },
  { id: 'integrations', labelKey: 'integrations', icon: ExtensionOutlinedIcon, permission: PERMISSIONS.TENANT_MANAGE },
]

const FINANCE_ITEMS: NavItemDef[] = [
  { id: 'financial-profile', labelKey: 'financialProfile', icon: BadgeOutlinedIcon, permission: PERMISSIONS.FINANCE_MANAGE },
  { id: 'accounting-profile', labelKey: 'accountingProfile', icon: GavelOutlinedIcon, permission: PERMISSIONS.FINANCE_MANAGE },
  { id: 'default-accounts', labelKey: 'defaultAccounts', icon: AccountBalanceWalletOutlinedIcon, permission: PERMISSIONS.FINANCE_MANAGE },
  { id: 'chart-of-accounts', labelKey: 'chartOfAccounts', icon: AccountTreeOutlinedIcon, permission: PERMISSIONS.FINANCE_MANAGE },
]

const MANAGE_ACCOUNT_ITEMS: NavItemDef[] = [
  { id: 'delete-account', labelKey: 'manageAccounts', icon: GroupsIcon },
]

export default function SettingsPage() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
  const { section } = useParams()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const { can, isSuperAdmin, role } = usePermissions()
  const { user } = useAuth()
  const { supports, isPersonal } = useTenantKind()
  const { has } = useEntitlements()

  const visible = (items: NavItemDef[]) =>
    items.filter((i) => (!i.permission || can(i.permission)) && (!i.capability || supports(i.capability)))
  // This self-service destructive path is deliberately narrower than the
  // super-admin tenant console: only the band's tenant_admin may use it.
  const bandItems = [
    ...visible(BAND_ITEMS),
    ...(!isPersonal && role === 'tenant_admin' ? MANAGE_ACCOUNT_ITEMS : []),
  ]
  const canUseFinance = has(FEATURES.FINANCE)
  const financeItems = canUseFinance ? visible(FINANCE_ITEMS) : []
  const accessible = [...ACCOUNT_ITEMS, ...bandItems, ...financeItems]

  // A section param the caller can't access falls back to the first account
  // item — access is never leaked by rendering a gated pane.
  const activeItem = accessible.find((i) => i.id === section) ?? null
  const activeSection: SectionId = activeItem?.id ?? ACCOUNT_ITEMS[0].id

  const renderDetail = (id: SectionId) => {
    switch (id) {
      case 'preferences':
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <ThemeSettingsSection />
            <NotificationSettingsSection />
          </Box>
        )
      case 'billing':
        return <BillingSettingsSection />
      case 'connected-accounts':
        return <ConnectedAccountsSection />
      case 'my-availability':
        return <MyAvailabilitySection />
      case 'accent':
        return <AccentColorSection />
      case 'members':
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <MembersSection />
            <InvitesSection canIssueAdmin={isSuperAdmin} />
            <DiscoverabilitySection />
          </Box>
        )
      case 'storage':
        return <StorageUsageSection />
      case 'integrations':
        return <IntegrationsSection />
      case 'financial-profile':
        return <FinancialProfileSection />
      case 'accounting-profile':
        return <AccountingProfileSection />
      case 'default-accounts':
        return <AccountingSettingsSection />
      case 'chart-of-accounts':
        return <ChartOfAccountsSection />
      case 'delete-account':
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {supports(TENANT_CAPABILITIES.BAND_PROFILE_CLAIM) && <BandProfileClaimSection />}
            <TenantSlugSection key={String(user?.activeTenantId ?? '')} />
            <TenantDeletionSection />
          </Box>
        )
      default:
        return null
    }
  }

  const renderNavItem = (item: NavItemDef) => {
    const Icon = item.icon
    return (
      <ListItemButton
        key={item.id}
        selected={!isMobile && activeSection === item.id}
        onClick={() => navigate(`/settings/${item.id}`)}
      >
        <ListItemIcon><Icon fontSize="small" /></ListItemIcon>
        <ListItemText primary={t($ => $.nav.items[item.labelKey])} />
      </ListItemButton>
    )
  }

  // Mobile: a chosen section renders on its own with a back arrow to the menu.
  if (isMobile && activeItem) {
    return (
      <Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
          <IconButton edge="start" aria-label={t($ => $.nav.backAria)} onClick={() => navigate('/settings')}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6">{t($ => $.nav.items[activeItem.labelKey])}</Typography>
        </Stack>
        {renderDetail(activeItem.id)}
      </Box>
    )
  }

  const navCard = (
    <Paper
      variant="outlined"
      sx={{ width: { xs: '100%', md: 260 }, flexShrink: 0, alignSelf: 'flex-start' }}
    >
      <List dense>
        <ListSubheader disableSticky>{t($ => $.nav.accountSettings)}</ListSubheader>
        {ACCOUNT_ITEMS.map(renderNavItem)}
        {bandItems.length > 0 && [
          <ListSubheader key="band-header" disableSticky>
            {isPersonal ? t($ => $.nav.workspaceSettings) : t($ => $.nav.bandSettings)}
          </ListSubheader>,
          ...bandItems.map(renderNavItem),
        ]}
        {financeItems.length > 0 && [
          <ListSubheader key="finance-header" disableSticky>{t($ => $.nav.financeSettings)}</ListSubheader>,
          ...financeItems.map(renderNavItem),
        ]}
      </List>
    </Paper>
  )

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>{t($ => $.title)}</Typography>
      <SubscriptionSummaryCard />
      {canUseFinance && can(PERMISSIONS.FINANCE_MANAGE) && <FinanceWizardCard />}
      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
        {navCard}
        {!isMobile && <Box sx={{ flexGrow: 1, minWidth: 0 }}>{renderDetail(activeSection)}</Box>}
      </Box>
    </Box>
  )
}
