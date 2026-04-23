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
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import EventNoteIcon from '@mui/icons-material/EventNote'
import GroupIcon from '@mui/icons-material/Group'
import LogoutIcon from '@mui/icons-material/Logout'
import MenuIcon from '@mui/icons-material/Menu'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import NotificationsIcon from '@mui/icons-material/Notifications'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff'
import PersonIcon from '@mui/icons-material/Person'
import { useProfile } from '../contexts/profileContext.js'
import { useAuth } from '../contexts/authContext.js'
import { usePushNotifications } from '../hooks/usePushNotifications.js'

const DRAWER_WIDTH = 220

const BASE_NAV_ITEMS = [
  { to: '/', label: 'Profile', icon: PersonIcon },
  { to: '/gigs', label: 'Gigs', icon: EventIcon },
  { to: '/rehearsals', label: 'Rehearsals', icon: MusicNoteIcon },
  { to: '/events', label: 'Band Events', icon: EventNoteIcon },
  { to: '/tasks', label: 'Tasks', icon: ChecklistIcon },
  { to: '/availability', label: 'Calendar', icon: EventAvailableIcon },
  { to: '/email-templates', label: 'Email Templates', icon: EmailIcon },
]

const ADMIN_NAV_ITEMS = [
  { to: '/members', label: 'Members', icon: GroupIcon },
]

export default function AppShell() {
  const { pathname } = useLocation()
  const { bandName } = useProfile()
  const { user, logout } = useAuth()
  const { status: pushStatus, subscribe, unsubscribe } = usePushNotifications()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleNavClick = () => {
    if (isMobile) setMobileOpen(false)
  }

  const navItems = user?.isAdmin
    ? [...BASE_NAV_ITEMS, ...ADMIN_NAV_ITEMS]
    : BASE_NAV_ITEMS

  const drawerContent = (
    <>
      <Toolbar />
      <Box sx={{ overflow: 'auto', pt: 1 }}>
        <List>
          {navItems.map((item) => {
            const selected = pathname === item.to
            const Icon = item.icon
            return (
              <ListItemButton
                key={item.to}
                component={NavLink}
                to={item.to}
                selected={selected}
                onClick={handleNavClick}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Icon color={selected ? 'primary' : 'inherit'} />
                </ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
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
          <Box component="img" src="/icons/gigbuddy_logo_pick.png" alt="gigBuddy" sx={{ height: 32, width: 'auto', mr: 1 }} />
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
            width: DRAWER_WIDTH,
            flexShrink: 0,
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
