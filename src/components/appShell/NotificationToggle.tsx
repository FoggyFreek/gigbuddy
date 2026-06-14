import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import NotificationsIcon from '@mui/icons-material/Notifications'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff'

interface NotificationToggleProps {
  status: string
  onSubscribe: () => void
  onUnsubscribe: () => void
}

export default function NotificationToggle({ status, onSubscribe, onUnsubscribe }: NotificationToggleProps) {
  if (status === 'unsupported' || status === 'loading') return null

  const subscribed = status === 'subscribed'
  const denied = status === 'denied'

  let title = 'Enable notifications'
  if (subscribed) title = 'Notifications on — click to turn off'
  else if (denied) title = 'Notifications blocked in browser'

  let icon = <NotificationsNoneIcon />
  if (subscribed) icon = <NotificationsIcon />
  else if (denied) icon = <NotificationsOffIcon />

  return (
    <Tooltip title={title}>
      <span>
        <IconButton
          onClick={subscribed ? onUnsubscribe : onSubscribe}
          disabled={denied}
          aria-label="toggle notifications"
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  )
}
