import { useCallback, useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
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
import VolunteerActivismOutlined from '@mui/icons-material/VolunteerActivismOutlined'
import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined'
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined'
import LibraryMusicOutlined from '@mui/icons-material/LibraryMusicOutlined'
import QueueMusicOutlined from '@mui/icons-material/QueueMusicOutlined'
import { useProfile } from '../contexts/profileContext.ts'
import { useAuth } from '../contexts/authContext.ts'
import { usePushNotifications } from '../hooks/usePushNotifications.ts'
import { useTenantQuerySync } from '../hooks/useTenantQuerySync.ts'
import { useThemeMode } from '../contexts/themeModeContext.ts'
import { ContentWidthContext } from '../contexts/contentWidthContext.ts'
import NavGroup from './appShell/NavGroup.tsx'
import { isItemSelected } from './appShell/navSelection.ts'
import NotificationToggle from './appShell/NotificationToggle.tsx'
import SettingsMenu from './appShell/SettingsMenu.tsx'
import UserMenu from './appShell/UserMenu.tsx'
import type { Id } from '../types/entities.ts'

// Local type for NAV_GROUPS that mirrors the NavGroupDef shape NavGroup.tsx expects
// but also allows the optional adminOnly flag on child entries.
interface NavChildEntry {
  to: string
  label: string
  icon: SvgIconComponent
  adminOnly?: boolean
}

interface NavGroupEntry {
  key: string
  label: string
  icon: SvgIconComponent
  children: NavChildEntry[]
}

const DRAWER_WIDTH = 220
const COLLAPSED_DRAWER_WIDTH = 72
// Caps page content width on large screens so it stays centered instead of stretching edge-to-edge.
const CONTENT_MAX_WIDTH = 1400

const NAV_GROUPS: NavGroupEntry[] = [
  {
    key: 'overview',
    label: 'Overview',
    icon: SpaceDashboardTwoTone,
    children: [
      { to: '/', label: 'Dashboard', icon: DashboardOutlined },
      { to: '/financial', label: 'Financial', icon: QueryStatsOutlined },
      { to: '/profile', label: 'Profile', icon: PersonOutlined },
    ],
  },
  {
    key: 'planning',
    label: 'Planning',
    icon: EventNoteTwoTone,
    children: [
      { to: '/availability', label: 'Calendar', icon: CalendarMonthOutlined },
      { to: '/gigs', label: 'Gigs', icon: EventOutlined },
      { to: '/rehearsals', label: 'Rehearsals', icon: MusicNoteOutlined },
      { to: '/events', label: 'Band Events', icon: EventNoteOutlined },
      { to: '/tasks', label: 'Tasks', icon: ChecklistOutlined },
    ],
  },
  {
    key: 'repertoire',
    label: 'Repertoire',
    icon: LibraryMusicTwoTone,
    children: [
      { to: '/songs', label: 'Songs', icon: LibraryMusicOutlined },
      { to: '/setlists', label: 'Setlists', icon: QueueMusicOutlined },
    ],
  },
  {
    key: 'network',
    label: 'Network',
    icon: HubTwoTone,
    children: [
      { to: '/contacts', label: 'Contacts', icon: ContactsOutlined },
      { to: '/suppliers', label: 'Suppliers', icon: StorefrontOutlined },
      { to: '/venues', label: 'Venues', icon: LocationOnOutlined },
      { to: '/email-templates', label: 'Email Templates', icon: EmailOutlined },
    ],
  },
  {
    key: 'financial',
    label: 'Financial',
    icon: PaymentsTwoTone,
    children: [
      { to: '/invoices', label: 'Invoices', icon: ReceiptLongOutlined },
      { to: '/purchases', label: 'Purchases', icon: ShoppingCartOutlined },
      { to: '/merch', label: 'Merchandise', icon: SellOutlined },
      { to: '/reimbursements', label: 'Reimbursements', icon: VolunteerActivismOutlined },
    ],
  },
  {
    key: 'accounting',
    label: 'Accounting',
    icon: AccountBalanceTwoTone,
    children: [
      { to: '/journal', label: 'Journal', icon: MenuBookOutlined },
      { to: '/ledger', label: 'Ledger entries', icon: ListAltOutlined },
      { to: '/vat-returns', label: 'VAT declarations', icon: AccountBalanceOutlined, adminOnly: true },
      { to: '/reports', label: 'Reports', icon: AssessmentOutlined },
    ],
  },

]

export default function AppShell() {
  const { pathname } = useLocation()
  const { bandName } = useProfile()
  const { user, logout, switchTenant } = useAuth()
  const { status: pushStatus, subscribe, unsubscribe } = usePushNotifications()
  const { mode, toggleTheme } = useThemeMode()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
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
  const isTenantAdmin =
    isSuperAdmin || user?.activeTenantRole === 'tenant_admin'

  // Admin-only nav items (adminOnly: true) are hidden from plain members; the
  // matching routes sit behind RequireTenantAdmin and the API behind the
  // tenantAdmin gate, so this is presentation, not the defense.
  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS
        .map((g) => ({ ...g, children: g.children.filter((c) => !('adminOnly' in c && c.adminOnly) || isTenantAdmin) }))
        .filter((g) => g.children.length > 0),
    [isTenantAdmin],
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
          <Tooltip title={isNavCollapsed ? 'Expand navigation' : 'Collapse navigation'}>
            <IconButton
              onClick={() => setNavCollapsed((collapsed) => !collapsed)}
              aria-label={isNavCollapsed ? 'expand navigation' : 'collapse navigation'}
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
              aria-label="open navigation"
            >
              <MenuIcon />
            </IconButton>
          )}
          <Box component="img" src="/icons/gigbuddy_logo_pick.png" alt="gigBuddy" sx={{ height: 32, width: 'auto', mr: 1, filter: theme.palette.mode === 'dark' ? 'invert(1)' : 'none' }} />
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
          <NotificationToggle
            status={pushStatus}
            onSubscribe={subscribe}
            onUnsubscribe={unsubscribe}
          />
          <Tooltip title="Settings">
            <IconButton
              onClick={(e) => setSettingsMenuAnchor(e.currentTarget)}
              aria-label="open settings menu"
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
            isTenantAdmin={isTenantAdmin}
            isSuperAdmin={isSuperAdmin}
          />
          {user && (
            <>
              <Tooltip title={user.name || user.email}>
                <IconButton
                  onClick={(e) => setUserMenuAnchor(e.currentTarget)}
                  size="small"
                  aria-label="open user menu"
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
                isSuperAdmin={isSuperAdmin}
                approvedMemberships={approvedMemberships}
                activeTenantId={activeTenantId ?? undefined}
                onSwitch={handleSwitch}
                onLogout={() => { setUserMenuAnchor(null); logout() }}
              />
            </>
          )}
        </Toolbar>
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
