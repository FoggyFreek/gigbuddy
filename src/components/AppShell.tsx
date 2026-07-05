import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import List from '@mui/material/List'
import TextField from '@mui/material/TextField'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import type { SvgIconComponent } from '@mui/icons-material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import SearchIcon from '@mui/icons-material/Search'
// Group headers use TwoTone icons (slightly larger); children use Outlined.
import SpaceDashboardTwoTone from '@mui/icons-material/SpaceDashboardTwoTone'
import EventNoteTwoTone from '@mui/icons-material/EventNoteTwoTone'
import HubTwoTone from '@mui/icons-material/HubTwoTone'
import PaymentsTwoTone from '@mui/icons-material/PaymentsTwoTone'
import LibraryMusicTwoTone from '@mui/icons-material/LibraryMusicTwoTone'
import AccountBalanceTwoTone from '@mui/icons-material/AccountBalanceTwoTone'
import DashboardOutlined from '@mui/icons-material/DashboardOutlined'
import PersonOutlined from '@mui/icons-material/PersonOutlined'
import QueryStatsOutlined from '@mui/icons-material/QueryStatsOutlined'
import EventOutlined from '@mui/icons-material/EventOutlined'
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import MusicNoteOutlined from '@mui/icons-material/MusicNoteOutlined'
import ChecklistOutlined from '@mui/icons-material/ChecklistOutlined'
import EventNoteOutlined from '@mui/icons-material/EventNoteOutlined'
import EmailOutlined from '@mui/icons-material/EmailOutlined'
import LocationOnOutlined from '@mui/icons-material/LocationOnOutlined'
import ContactsOutlined from '@mui/icons-material/ContactsOutlined'
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined'
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined'
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined'
import SellOutlined from '@mui/icons-material/SellOutlined'
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined'
import ListAltOutlined from '@mui/icons-material/ListAltOutlined'
import ManageSearchOutlined from '@mui/icons-material/ManageSearchOutlined'
import VolunteerActivismOutlined from '@mui/icons-material/VolunteerActivismOutlined'
import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined'
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined'
import LibraryMusicOutlined from '@mui/icons-material/LibraryMusicOutlined'
import QueueMusicOutlined from '@mui/icons-material/QueueMusicOutlined'
import { useProfile } from '../contexts/profileContext.ts'
import { useAuth } from '../contexts/authContext.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { useEntitlements } from '../hooks/useEntitlements.ts'
import { planLogoSrc } from '../utils/planLogo.ts'
import { PERMISSIONS, type Permission } from '../auth/permissions.ts'
import { FEATURES, type Feature } from '../auth/entitlements.ts'
import { useTenantQuerySync } from '../hooks/useTenantQuerySync.ts'
import { useThemeMode } from '../contexts/themeModeContext.ts'
import { ContentWidthContext } from '../contexts/contentWidthContext.ts'
import NavGroup from './appShell/NavGroup.tsx'
import { isItemSelected } from './appShell/navSelection.ts'
import NotificationsBell from './appShell/NotificationsBell.tsx'
import SearchPanel from './appShell/SearchPanel.tsx'
import SettingsMenu from './appShell/SettingsMenu.tsx'
import UserMenu from './appShell/UserMenu.tsx'
import type { Id } from '../types/entities.ts'

// Local type for NAV_GROUPS. Group/item display labels come from the `navigation`
// i18n namespace, keyed by `key` (groups) and `i18nKey` (items). The typed unions
// keep the dynamic selector index (`t($ => $.items[i18nKey])`) compile-checked —
// an out-of-set key is a TS error, not a silent miss. Items with a `permission`
// are hidden unless the active tenant role grants it.
type NavGroupKey = 'overview' | 'planning' | 'repertoire' | 'network' | 'financial' | 'accounting'
type NavItemKey =
  | 'dashboard' | 'financial' | 'profile' | 'availability' | 'gigs' | 'rehearsals'
  | 'bandEvents' | 'tasks' | 'songs' | 'setlists' | 'contacts' | 'suppliers'
  | 'venues' | 'emailTemplates' | 'invoices' | 'purchases' | 'merch' | 'reimbursements'
  | 'journal' | 'ledger' | 'ledgerEntries' | 'vatReturns' | 'reports'

interface NavChildEntry {
  to: string
  i18nKey: NavItemKey
  icon: SvgIconComponent
  permission?: Permission
  // Entitlement feature this surface needs. When the active plan lacks it, the
  // item stays VISIBLE but renders a diamond icon and links to the upsell page
  // (it is NOT hidden — that's what permission does). See project memory.
  feature?: Feature
}

interface NavGroupEntry {
  key: NavGroupKey
  icon: SvgIconComponent
  children: NavChildEntry[]
}

const DRAWER_WIDTH = 240
const COLLAPSED_DRAWER_WIDTH = 72
// Caps page content width on large screens so it stays centered instead of stretching edge-to-edge.
const CONTENT_MAX_WIDTH = 1400

const NAV_GROUPS: NavGroupEntry[] = [
  {
    key: 'overview',
    icon: SpaceDashboardTwoTone,
    children: [
      { to: '/', i18nKey: 'dashboard', icon: DashboardOutlined },
      { to: '/financial', i18nKey: 'financial', icon: QueryStatsOutlined, permission: PERMISSIONS.FINANCE_VIEW, feature: FEATURES.FINANCE },
      { to: '/profile', i18nKey: 'profile', icon: PersonOutlined },
    ],
  },
  {
    key: 'planning',
    icon: EventNoteTwoTone,
    children: [
      { to: '/availability', i18nKey: 'availability', icon: CalendarMonthOutlined },
      { to: '/gigs', i18nKey: 'gigs', icon: EventOutlined },
      { to: '/rehearsals', i18nKey: 'rehearsals', icon: MusicNoteOutlined },
      { to: '/events', i18nKey: 'bandEvents', icon: EventNoteOutlined },
      { to: '/tasks', i18nKey: 'tasks', icon: ChecklistOutlined },
    ],
  },
  {
    key: 'repertoire',
    icon: LibraryMusicTwoTone,
    children: [
      { to: '/songs', i18nKey: 'songs', icon: LibraryMusicOutlined },
      { to: '/setlists', i18nKey: 'setlists', icon: QueueMusicOutlined },
    ],
  },
  {
    key: 'network',
    icon: HubTwoTone,
    children: [
      { to: '/contacts', i18nKey: 'contacts', icon: ContactsOutlined },
      { to: '/suppliers', i18nKey: 'suppliers', icon: StorefrontOutlined },
      { to: '/venues', i18nKey: 'venues', icon: LocationOnOutlined },
      { to: '/email-templates', i18nKey: 'emailTemplates', icon: EmailOutlined },
    ],
  },
  {
    key: 'financial',
    icon: PaymentsTwoTone,
    children: [
      { to: '/invoices', i18nKey: 'invoices', icon: ReceiptLongOutlined, permission: PERMISSIONS.FINANCE_VIEW, feature: FEATURES.FINANCE },
      { to: '/purchases', i18nKey: 'purchases', icon: ShoppingCartOutlined, permission: PERMISSIONS.PURCHASE_CREATE, feature: FEATURES.FINANCE },
      { to: '/merch', i18nKey: 'merch', icon: SellOutlined, permission: PERMISSIONS.FINANCE_VIEW, feature: FEATURES.FINANCE },
      { to: '/reimbursements', i18nKey: 'reimbursements', icon: VolunteerActivismOutlined, permission: PERMISSIONS.FINANCE_VIEW, feature: FEATURES.FINANCE },
    ],
  },
  {
    key: 'accounting',
    icon: AccountBalanceTwoTone,
    children: [
      { to: '/journal', i18nKey: 'journal', icon: MenuBookOutlined, permission: PERMISSIONS.FINANCE_VIEW, feature: FEATURES.FINANCE },
      { to: '/ledger', i18nKey: 'ledger', icon: ListAltOutlined, permission: PERMISSIONS.FINANCE_VIEW, feature: FEATURES.FINANCE },
      { to: '/ledger-entries', i18nKey: 'ledgerEntries', icon: ManageSearchOutlined, permission: PERMISSIONS.FINANCE_VIEW, feature: FEATURES.FINANCE },
      { to: '/vat-returns', i18nKey: 'vatReturns', icon: AccountBalanceOutlined, permission: PERMISSIONS.FINANCE_VIEW, feature: FEATURES.FINANCE },
      { to: '/reports', i18nKey: 'reports', icon: AssessmentOutlined, permission: PERMISSIONS.FINANCE_VIEW, feature: FEATURES.FINANCE },
    ],
  },

]

export default function AppShell() {
  const { t } = useTranslation('navigation')
  const { pathname } = useLocation()
  const { bandName } = useProfile()
  const { user, logout, switchTenant } = useAuth()
  const { mode, toggleTheme } = useThemeMode()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null)
  const [settingsMenuAnchor, setSettingsMenuAnchor] = useState<HTMLElement | null>(null)
  // When a SplitView opens its master-detail layout it asks for full width;
  // otherwise content stays capped and centered (see CONTENT_MAX_WIDTH).
  const [wideContent, setWideContent] = useState(false)
  const requestWideContent = useCallback((wide: boolean) => setWideContent(wide), [])

  useTenantQuerySync()

  const handleNavClick = () => {
    if (isMobile) setMobileOpen(false)
  }

  const isSuperAdmin = !!user?.isSuperAdmin
  const { can, canManageMembers, canManageTenant } = usePermissions()
  const { has, financeReadOnly, planSlug, locked, unenforced } = useEntitlements()

  // Header logo reflects the active subscription tier; fallback-locked or
  // unenforced (ownerless) tenants keep the standard logo.
  const tierLogo = !locked && !unenforced ? planLogoSrc(planSlug) : null

  // Whether the active plan grants a nav item's feature. Finance is special:
  // reads survive a downgrade (financeReadOnly), so a grandfathered tenant still
  // reaches finance normally; only a tenant that never had finance sees it
  // locked. Everything else keys straight off `has`.
  const featureAccessible = useCallback(
    (feature?: Feature) => {
      if (!feature) return true
      if (feature === FEATURES.FINANCE) return has(FEATURES.FINANCE) || financeReadOnly
      return has(feature)
    },
    [has, financeReadOnly],
  )

  // Nav items carrying a `permission` are hidden unless the active role grants
  // it (role, not tier). Items carrying a `feature` the plan lacks stay VISIBLE
  // but render locked: a diamond icon and a link to the upsell page. Routes sit
  // behind RequirePermission and the API behind the matching gate — this is
  // presentation, not the defense.
  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS
        .map((g) => ({
          key: g.key,
          icon: g.icon,
          label: t($ => $.groups[g.key]),
          children: g.children
            .filter((c) => !c.permission || can(c.permission))
            .map((c) => {
              const locked = !featureAccessible(c.feature)
              return {
                // Stable per-item identity for React keys. `to` can't serve:
                // every locked item shares the same upsell route, and duplicate
                // keys duplicate items when a tenant switch relocks/unlocks.
                key: c.i18nKey,
                to: locked ? `/upgrade/${c.feature}` : c.to,
                icon: c.icon,
                label: t($ => $.items[c.i18nKey]),
                locked,
              }
            }),
        }))
        .filter((g) => g.children.length > 0),
    [can, featureAccessible, t],
  )

  // Single-open accordion: the group containing the active route auto-expands,
  // and clicking another header switches which one is open. We follow the route
  // by adjusting state during render (React's recommended pattern) rather than
  // an effect, so navigation re-opens the owning group while manual toggles in
  // between are still honoured.
  const activeGroupKey = useMemo(
    () => visibleGroups.find((g) => g.children.some((c) => isItemSelected(c.to, pathname)))?.key ?? null,
    [visibleGroups, pathname],
  )
  const [expandedKey, setExpandedKey] = useState<string | null>(activeGroupKey)
  const [prevActiveKey, setPrevActiveKey] = useState<string | null>(activeGroupKey)
  if (activeGroupKey && activeGroupKey !== prevActiveKey) {
    setPrevActiveKey(activeGroupKey)
    setExpandedKey(activeGroupKey)
  }
  const handleToggleGroup = (key: string) => setExpandedKey((k) => (k === key ? null : key))

  const memberships = user?.memberships || []
  const approvedMemberships = memberships
    .filter((m) => m.status === 'approved' && m.tenantId != null)
    .map((m) => ({ tenantId: m.tenantId!, tenantName: m.tenantName, role: m.role }))
  const activeTenantId: Id | null = user?.activeTenantId ?? null

  const handleSwitch = async (tenantId: Id) => {
    setUserMenuAnchor(null)
    if (tenantId === activeTenantId) return
    try {
      await switchTenant(tenantId)
    } catch {
      // noop — failure leaves user on current tenant
    }
  }

  const isNavCollapsed = !isMobile && navCollapsed
  const drawerWidth = isNavCollapsed ? COLLAPSED_DRAWER_WIDTH : DRAWER_WIDTH

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar />
      <Box sx={{ flex: 1, overflow: 'auto', pt: 1 }}>
        <List>
          {visibleGroups.map((group) => (
            <NavGroup
              key={group.key}
              group={group}
              ariaLabel={t($ => $.shell.groupAria, { name: group.label })}
              pathname={pathname}
              isNavCollapsed={isNavCollapsed}
              expanded={expandedKey === group.key}
              onToggle={handleToggleGroup}
              onNavClick={handleNavClick}
            />
          ))}
        </List>
      </Box>
      {!isMobile && (
        <Box sx={{ display: 'flex', justifyContent: isNavCollapsed ? 'center' : 'flex-end', px: 1, py: 0.5 }}>
          <Tooltip title={isNavCollapsed ? t($ => $.shell.expandNav) : t($ => $.shell.collapseNav)}>
            <IconButton
              onClick={() => setNavCollapsed((collapsed) => !collapsed)}
              aria-label={isNavCollapsed ? t($ => $.shell.expandNavAria) : t($ => $.shell.collapseNavAria)}
              size="small"
            >
              {isNavCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          zIndex: (t) => t.zIndex.drawer + 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          color: 'text.primary',
        }}
      >
        <Toolbar>
          {isMobile && (
            <IconButton
              edge="start"
              onClick={() => setMobileOpen((o) => !o)}
              sx={{ mr: 1 }}
              aria-label={t($ => $.shell.openNav)}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Box
            component="img"
            src={tierLogo ?? '/icons/gigbuddy_logo_pick.png'}
            alt="gigBuddy"
            sx={{
              height: 32,
              width: 'auto',
              mr: 1,
              // The tier logos are full-color; only the monochrome default logo
              // inverts in dark mode.
              filter: !tierLogo && theme.palette.mode === 'dark' ? 'invert(1)' : 'none',
            }}
          />
          <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
              gigBuddy
            </Typography>
            {bandName && (
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.1, mt: 0.5 }}>
                {bandName}
              </Typography>
            )}
          </Box>
          {!isMobile && (
            <ClickAwayListener onClickAway={() => setSearchOpen(false)}>
              <Box sx={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', width: { sm: 480, md: 540 } }}>
                <TextField
                  fullWidth
                  size="small"
                  type="search"
                  autoComplete="off"
                  placeholder={t($ => $.shell.searchPlaceholder)}
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  onFocus={() => setSearchOpen(true)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                      ),
                    }
                  }}
                />
                {searchOpen && (
                  <Box sx={{ position: 'absolute', top: '100%', left: 0, right: 0 }}>
                    <SearchPanel
                      key={activeTenantId ?? 'no-tenant'}
                      query={searchValue}
                      tenantId={activeTenantId}
                      onNavigate={() => { setSearchOpen(false); setSearchValue('') }}
                    />
                  </Box>
                )}
              </Box>
            </ClickAwayListener>
          )}
          {isMobile && (
            <Tooltip title={t($ => $.shell.search)}>
              <IconButton onClick={() => setSearchOpen((o) => !o)} aria-label={t($ => $.shell.openSearch)}>
                <SearchIcon />
              </IconButton>
            </Tooltip>
          )}
          <NotificationsBell />
          <Tooltip title={t($ => $.shell.settings)}>
            <IconButton
              onClick={(e) => setSettingsMenuAnchor(e.currentTarget)}
              aria-label={t($ => $.shell.openSettings)}
            >
              <SettingsOutlinedIcon />
            </IconButton>
          </Tooltip>
          <SettingsMenu
            anchorEl={settingsMenuAnchor}
            open={Boolean(settingsMenuAnchor)}
            onClose={() => setSettingsMenuAnchor(null)}
            mode={mode}
            onToggleTheme={() => { toggleTheme(); setSettingsMenuAnchor(null) }}
            canManageMembers={canManageMembers}
            canManageTenant={canManageTenant}
            isSuperAdmin={isSuperAdmin}
          />
          {user && (
            <>
              <Tooltip title={user.name || user.email}>
                <IconButton
                  onClick={(e) => setUserMenuAnchor(e.currentTarget)}
                  size="small"
                  aria-label={t($ => $.shell.openUserMenu)}
                  sx={{ ml: 1 }}
                >
                  <Avatar
                    src={user.pictureUrl}
                    sx={{ width: 32, height: 32, fontSize: 14 }}
                  >
                    {user.name?.[0]}
                  </Avatar>
                </IconButton>
              </Tooltip>
              <UserMenu
                anchorEl={userMenuAnchor}
                open={Boolean(userMenuAnchor)}
                onClose={() => setUserMenuAnchor(null)}
                approvedMemberships={approvedMemberships}
                activeTenantId={activeTenantId ?? undefined}
                onSwitch={handleSwitch}
                onLogout={() => { setUserMenuAnchor(null); logout() }}
              />
            </>
          )}
        </Toolbar>
        {isMobile && searchOpen && (
          <ClickAwayListener onClickAway={() => setSearchOpen(false)}>
            <Box>
            <Box sx={{ px: 2, pb: 1 }}>
              <TextField
                fullWidth
                autoFocus
                size="small"
                type="search"
                autoComplete="off"
                placeholder={t($ => $.shell.searchPlaceholderShort)}
                value={searchValue}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => setSearchValue(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                    )
                  }
                }}
              />
            </Box>
            <SearchPanel
              key={activeTenantId ?? 'no-tenant'}
              query={searchValue}
              tenantId={activeTenantId}
              onNavigate={() => { setSearchOpen(false); setSearchValue('') }}
            />
          </Box>
          </ClickAwayListener>
        )}
      </AppBar>

      {isMobile ? (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              borderRight: '1px solid',
              borderColor: 'divider',
            },
          }}
        >
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              boxSizing: 'border-box',
              borderRight: '1px solid',
              borderColor: 'divider',
              overflowX: 'hidden',
              transition: (t) =>
                t.transitions.create('width', {
                  easing: t.transitions.easing.sharp,
                  duration: t.transitions.duration.shorter,
                }),
            },
            transition: (t) =>
              t.transitions.create('width', {
                easing: t.transitions.easing.sharp,
                duration: t.transitions.duration.shorter,
              }),
          }}
        >
          {drawerContent}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{ flexGrow: 1, p: 3, overflow: 'auto', bgcolor: 'background.default' }}
        key={activeTenantId ?? 'no-tenant'}
      >
        <Toolbar />
        <Box sx={{ maxWidth: wideContent ? 'none' : CONTENT_MAX_WIDTH, mx: 'auto' }}>
          <ContentWidthContext.Provider value={requestWideContent}>
            <Outlet />
          </ContentWidthContext.Provider>
        </Box>
      </Box>
    </Box>
  )
}
