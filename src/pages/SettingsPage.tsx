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
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined'
import GroupIcon from '@mui/icons-material/Group'
import VerifiedOutlinedIcon from '@mui/icons-material/VerifiedOutlined'
import StorageIcon from '@mui/icons-material/Storage'
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined'
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined'
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined'
import { usePermissions } from '../hooks/usePermissions.ts'
import { PERMISSIONS, type Permission } from '../auth/permissions.ts'
import SubscriptionSummaryCard from '../components/settings/SubscriptionSummaryCard.tsx'
import FinanceWizardCard from '../components/settings/FinanceWizardCard.tsx'
import NotificationSettingsSection from '../components/account/NotificationSettingsSection.tsx'
import ThemeSettingsSection from '../components/account/ThemeSettingsSection.tsx'
import BillingSettingsSection from '../components/account/BillingSettingsSection.tsx'
import ConnectedAccountsSection from '../components/account/ConnectedAccountsSection.tsx'
import AccentColorSection from '../components/settings/AccentColorSection.tsx'
import StorageUsageSection from '../components/settings/StorageUsageSection.tsx'
import IntegrationsSection from '../components/settings/IntegrationsSection.tsx'
import MembersSection from '../components/settings/MembersSection.tsx'
import ChartOfAccountsSection from '../components/settings/ChartOfAccountsSection.tsx'
import AccountingSettingsSection from '../components/settings/AccountingSettingsSection.tsx'
import AccountingProfileSection from '../components/settings/AccountingProfileSection.tsx'
import FinancialProfileSection from '../components/settings/FinancialProfileSection.tsx'
import BandProfileClaimSection from '../components/settings/BandProfileClaimSection.tsx'
import MyAvailabilitySection from '../components/settings/MyAvailabilitySection.tsx'
import DiscoverabilitySection from '../components/settings/DiscoverabilitySection.tsx'
import InvitesSection from '../components/InvitesSection.tsx'
import { useTenantKind } from '../hooks/useTenantKind.ts'
import { TENANT_CAPABILITIES, type TenantCapability } from '../auth/tenantCapabilities.ts'

// A single settings surface that merges the former per-user account settings,
// members management, and tenant (band) settings. Desktop uses a master-detail
// layout (nav card + detail pane); mobile drills into each section separately
// with a back arrow. The nav is role-gated: band and finance items appear only
// when the active tenant role grants the matching permission.
type SectionId =
  | 'preferences' | 'billing' | 'connected-accounts' | 'my-availability'
  | 'accent' | 'members' | 'band-profile' | 'storage'
  | 'integrations' | 'chart-of-accounts' | 'default-accounts'
  | 'financial-profile' | 'accounting-profile'

// camelCase leaf keys under settings.nav.items — a literal union so the typed
// selector index (`t($ => $.nav.items[labelKey])`) stays compile-checked.
type ItemLabelKey =
  | 'preferences' | 'billing' | 'connectedAccounts' | 'myAvailability' | 'accent' | 'membersAndInvites' | 'bandProfile'
  | 'storage' | 'integrations' | 'chartOfAccounts' | 'defaultAccounts'
  | 'financialProfile' | 'accountingProfile'

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
  { id: 'billing', labelKey: 'billing', icon: CreditCardOutlinedIcon },
  { id: 'connected-accounts', labelKey: 'connectedAccounts', icon: LinkOutlinedIcon },
  // Availability belongs to the user, not a tenant, so its privacy and
  // delegation controls sit with the account items — never under a band.
  { id: 'my-availability', labelKey: 'myAvailability', icon: EventAvailableOutlinedIcon },
]

const BAND_ITEMS: NavItemDef[] = [
  { id: 'accent', labelKey: 'accent', icon: PaletteOutlinedIcon, permission: PERMISSIONS.TENANT_MANAGE },
  // A workspace of one has no roster to manage and nobody to invite into it.
  { id: 'members', labelKey: 'membersAndInvites', icon: GroupIcon, permission: PERMISSIONS.MEMBERS_MANAGE, capability: TENANT_CAPABILITIES.BAND_MEMBERSHIP_ADMIN },
  // Claiming the global profile musicians have been tagging events against.
  // Band-only, and an administrative act — see docs/tenant-kind-architecture.md.
  { id: 'band-profile', labelKey: 'bandProfile', icon: VerifiedOutlinedIcon, permission: PERMISSIONS.TENANT_MANAGE, capability: TENANT_CAPABILITIES.BAND_PROFILE_CLAIM },
  { id: 'storage', labelKey: 'storage', icon: StorageIcon, permission: PERMISSIONS.TENANT_MANAGE },
  { id: 'integrations', labelKey: 'integrations', icon: ExtensionOutlinedIcon, permission: PERMISSIONS.TENANT_MANAGE },
]

// Uniformly gated on finance.manage to match the APIs behind them (both
// /accounts and /accounting-profile mutate under that permission), so a
// financial_admin reaches exactly the records they are allowed to change.
const FINANCE_ITEMS: NavItemDef[] = [
  { id: 'financial-profile', labelKey: 'financialProfile', icon: BadgeOutlinedIcon, permission: PERMISSIONS.FINANCE_MANAGE },
  { id: 'accounting-profile', labelKey: 'accountingProfile', icon: GavelOutlinedIcon, permission: PERMISSIONS.FINANCE_MANAGE },
  { id: 'default-accounts', labelKey: 'defaultAccounts', icon: AccountBalanceWalletOutlinedIcon, permission: PERMISSIONS.FINANCE_MANAGE },
  { id: 'chart-of-accounts', labelKey: 'chartOfAccounts', icon: AccountTreeOutlinedIcon, permission: PERMISSIONS.FINANCE_MANAGE },
]

export default function SettingsPage() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
  const { section } = useParams()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const { can, isSuperAdmin } = usePermissions()
  const { supports, isPersonal } = useTenantKind()

  const visible = (items: NavItemDef[]) =>
    items.filter((i) => (!i.permission || can(i.permission)) && (!i.capability || supports(i.capability)))
  const bandItems = visible(BAND_ITEMS)
  const financeItems = visible(FINANCE_ITEMS)
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
      case 'band-profile':
        return <BandProfileClaimSection />
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
      {can(PERMISSIONS.FINANCE_MANAGE) && <FinanceWizardCard />}
      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
        {navCard}
        {!isMobile && <Box sx={{ flexGrow: 1, minWidth: 0 }}>{renderDetail(activeSection)}</Box>}
      </Box>
    </Box>
  )
}
