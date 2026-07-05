import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Avatar from '@mui/material/Avatar'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemAvatar from '@mui/material/ListItemAvatar'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Popover from '@mui/material/Popover'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import { useAuth } from '../../contexts/authContext.ts'
import {
  listNotifications,
  markRead,
  markAllRead,
  deleteNotification,
} from '../../api/notifications.ts'
import { formatRelativeTime } from '../../utils/dateFormat.ts'
import type { AppNotification } from '../../types/entities.ts'

const POLL_INTERVAL_MS = 60_000

// Cross-tenant profile pictures go through the membership-authorized notifications
// endpoint — the generic /api/files route only serves the *active* tenant.
function avatarSrc(n: AppNotification): string {
  return n.tenantAvatarPath && n.tenantId != null
    ? `/api/notifications/tenant-avatar/${n.tenantId}`
    : '/share/logo.png'
}

export default function NotificationsBell() {
  const { t, i18n } = useTranslation('notifications')
  const navigate = useNavigate()
  const { user, switchTenant } = useAuth()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const refresh = useCallback(() => {
    listNotifications()
      .then((data) => {
        setNotifications(data.notifications)
        setUnreadCount(data.unreadCount)
      })
      .catch(() => {
        // transient — the next focus/poll refresh retries
      })
  }, [])

  useEffect(() => {
    refresh()
    const onFocus = () => { refresh() }
    window.addEventListener('focus', onFocus)
    // Visibility-gated polling keeps the dot live during an active session
    // without websockets; hidden tabs skip the request entirely.
    const interval = window.setInterval(() => {
      if (!document.hidden) refresh()
    }, POLL_INTERVAL_MS)
    // The service worker posts { type: 'notification' } on push receipt so the
    // bell updates instantly for push-subscribed browsers.
    const onSwMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'notification') refresh()
    }
    navigator.serviceWorker?.addEventListener('message', onSwMessage)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
      navigator.serviceWorker?.removeEventListener('message', onSwMessage)
    }
  }, [refresh])

  const activeTenantId = user?.activeTenantId ?? null

  const handleMarkAllRead = () => {
    const now = new Date().toISOString()
    setNotifications((list) => list.map((n) => (n.readAt ? n : { ...n, readAt: now })))
    setUnreadCount(0)
    markAllRead().catch(() => { refresh() })
  }

  const handleDelete = (n: AppNotification) => {
    setNotifications((list) => list.filter((item) => item.id !== n.id))
    if (!n.readAt) setUnreadCount((count) => Math.max(0, count - 1))
    deleteNotification(n.id).catch(() => { refresh() })
  }

  const handleItemClick = async (n: AppNotification) => {
    setAnchorEl(null)
    if (!n.readAt) {
      const now = new Date().toISOString()
      setNotifications((list) => list.map((item) => (item.id === n.id ? { ...item, readAt: now } : item)))
      setUnreadCount((count) => Math.max(0, count - 1))
      markRead(n.id).catch(() => { refresh() })
    }
    // User-level (billing) notifications carry no tenant — never switch bands.
    if (n.tenantId !== null && n.tenantId !== activeTenantId) {
      try {
        await switchTenant(n.tenantId)
      } catch {
        return // stay put — the target band is not reachable
      }
    }
    navigate(n.url)
  }

  const openSettings = () => {
    setAnchorEl(null)
    navigate('/account/notifications')
  }

  return (
    <>
      <Tooltip title={t($ => $.bell.title)}>
        <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} aria-label={t($ => $.bell.ariaLabel)}>
          <Badge color="primary" variant="dot" invisible={unreadCount === 0}>
            <NotificationsNoneIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ width: 380, maxWidth: '90vw' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
              {t($ => $.bell.title)}
            </Typography>
            <Button size="small" onClick={handleMarkAllRead} disabled={unreadCount === 0}>
              {t($ => $.bell.markAllRead)}
            </Button>
            <IconButton size="small" onClick={openSettings} aria-label={t($ => $.bell.settingsAria)}>
              <SettingsOutlinedIcon fontSize="small" />
            </IconButton>
          </Box>
          <Divider />
          {notifications.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', px: 2, py: 3, textAlign: 'center' }}>
              {t($ => $.bell.empty)}
            </Typography>
          ) : (
            <List dense disablePadding sx={{ maxHeight: 420, overflow: 'auto' }}>
              {notifications.map((n) => (
                <ListItem
                  key={n.id}
                  disablePadding
                  secondaryAction={
                    <IconButton
                      edge="end"
                      size="small"
                      aria-label={t($ => $.bell.removeAria)}
                      onClick={() => handleDelete(n)}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  }
                >
                  <ListItemButton onClick={() => { void handleItemClick(n) }} sx={{ pr: 6 }}>
                    <ListItemAvatar>
                      <Avatar src={avatarSrc(n)} alt={n.tenantName ?? ''} sx={{ width: 36, height: 36 }} />
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Typography variant="body2" sx={{ fontWeight: n.readAt ? 400 : 600 }}>
                          {n.title}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                          {[n.body, formatRelativeTime(n.createdAt, i18n.language)].filter(Boolean).join(' · ')}
                        </Typography>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </Box>
      </Popover>
    </>
  )
}
