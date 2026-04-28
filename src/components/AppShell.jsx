import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import AppBar from '@mui/material/AppBar'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Toolbar from '@mui/material/Toolbar'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import ChecklistIcon from '@mui/icons-material/Checklist'
import EmailIcon from '@mui/icons-material/Email'
import EventIcon from '@mui/icons-material/Event'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import EventNoteIcon from '@mui/icons-material/EventNote'
import GroupIcon from '@mui/icons-material/Group'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import LightModeIcon from '@mui/icons-material/LightMode'
import LogoutIcon from '@mui/icons-material/Logout'
import MenuIcon from '@mui/icons-material/Menu'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import NotificationsIcon from '@mui/icons-material/Notifications'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff'
import ContactsIcon from '@mui/icons-material/Contacts'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import PersonIcon from '@mui/icons-material/Person'
import { useProfile } from '../contexts/profileContext.js'
import { useAuth } from '../contexts/authContext.js'
import { usePushNotifications } from '../hooks/usePushNotifications.js'
import { useThemeMode } from '../contexts/ThemeContext.jsx'

const DRAWER_WIDTH = 220
const COLLAPSED_DRAWER_WIDTH = 72

const BASE_NAV_ITEMS = [
  { to: '/', label: 'Profile', icon: PersonIcon },
  { to: '/gigs', label: 'Gigs', icon: EventIcon },
  { to: '/rehearsals', label: 'Rehearsals', icon: MusicNoteIcon },
  { to: '/events', label: 'Band Events', icon: EventNoteIcon },
  { to: '/tasks', label: 'Tasks', icon: ChecklistIcon },
  { to: '/availability', label: 'Calendar', icon: CalendarMonthIcon },
  { to: '/email-templates', label: 'Email Templates', icon: EmailIcon },
  { to: '/venues', label: 'Venues', icon: LocationOnIcon },
  { to: '/contacts', label: 'Contacts', icon: ContactsIcon },
]

const ADMIN_NAV_ITEMS = [
  { to: '/members', label: 'Members', icon: GroupIcon },
]

export default function AppShell() {
  const { pathname } = useLocation()
  const { bandName } = useProfile()
  const { user, logout } = useAuth()
  const { status: pushStatus, subscribe, unsubscribe } = usePushNotifications()
  const { mode, toggleTheme } = useThemeMode()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)

  const handleNavClick = () => {
    if (isMobile) setMobileOpen(false)
  }

  const navItems = user?.isAdmin
    ? [...BASE_NAV_ITEMS, ...ADMIN_NAV_ITEMS]
    : BASE_NAV_ITEMS
  const isNavCollapsed = !isMobile && navCollapsed
  const drawerWidth = isNavCollapsed ? COLLAPSED_DRAWER_WIDTH : DRAWER_WIDTH

  const drawerContent = (
    <>
      <Toolbar />
      <Box sx={{ overflow: 'auto', pt: 1 }}>
        {!isMobile && (
          <Box sx={{ display: 'flex', justifyContent: isNavCollapsed ? 'center' : 'flex-end', px: 1, mb: 1 }}>
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
        <List>
          {navItems.map((item) => {
            const selected = pathname === item.to
            const Icon = item.icon
            return (
              <Tooltip
                key={item.to}
                title={isNavCollapsed ? item.label : ''}
                placement="right"
                disableHoverListener={!isNavCollapsed}
              >
                <ListItemButton
                  component={NavLink}
                  to={item.to}
                  selected={selected}
                  onClick={handleNavClick}
                  sx={{
                    justifyContent: isNavCollapsed ? 'center' : 'flex-start',
                    minHeight: 48,
                    px: isNavCollapsed ? 1.5 : 2,
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: isNavCollapsed ? 0 : 36,
                      justifyContent: 'center',
                    }}
                  >
                    <Icon color={selected ? 'primary' : 'inherit'} />
                  </ListItemIcon>
                  {!isNavCollapsed && <ListItemText primary={item.label} />}
                </ListItemButton>
              </Tooltip>
            )
          })}
        </List>
      </Box>
    </>
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
            <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.1 }}>
              gigBuddy
            </Typography>
            {bandName && (
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.1, mt: 0.5 }}>
                {bandName}
              </Typography>
            )}
          </Box>
          {user && (
            <Tooltip title={user.name || user.email}>
              <Avatar
                src={user.pictureUrl}
                sx={{ width: 32, height: 32, mr: 1, fontSize: 14 }}
              >
                {user.name?.[0]}
              </Avatar>
            </Tooltip>
          )}
          {pushStatus !== 'unsupported' && pushStatus !== 'loading' && (
            <Tooltip
              title={
                pushStatus === 'subscribed'
                  ? 'Notifications on — click to turn off'
                  : pushStatus === 'denied'
                  ? 'Notifications blocked in browser'
                  : 'Enable notifications'
              }
            >
              <span>
                <IconButton
                  onClick={pushStatus === 'subscribed' ? unsubscribe : subscribe}
                  disabled={pushStatus === 'denied'}
                  aria-label="toggle notifications"
                >
                  {pushStatus === 'subscribed' ? (
                    <NotificationsIcon />
                  ) : pushStatus === 'denied' ? (
                    <NotificationsOffIcon />
                  ) : (
                    <NotificationsNoneIcon />
                  )}
                </IconButton>
              </span>
            </Tooltip>
          )}
          <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <IconButton onClick={toggleTheme} aria-label="toggle dark mode">
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Log out">
            <IconButton onClick={logout} aria-label="log out">
              <LogoutIcon />
            </IconButton>
          </Tooltip>
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
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  )
}
