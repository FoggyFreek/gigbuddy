import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Avatar from '@mui/material/Avatar'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { usePushNotifications } from '../../hooks/usePushNotifications.ts'
import { getNotificationPrefs, updateNotificationPrefs } from '../../api/notifications.ts'
import type { NotificationPrefs } from '../../types/entities.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'

// Maps the server's dash-cased notification types onto the camelCase i18n leaf
// keys so the typed selector index stays compile-checked (nav-items pattern).
type TypeLabelKey =
  | 'gigNew' | 'gigConfirmed' | 'gigImport'
  | 'rehearsalNew' | 'rehearsalConfirmed'
  | 'invoicePaid' | 'taskAssigned' | 'inviteRedeemed'

const TYPE_LABEL_KEYS: Record<string, TypeLabelKey> = {
  'gig-new': 'gigNew',
  'gig-confirmed': 'gigConfirmed',
  'gig-import': 'gigImport',
  'rehearsal-new': 'rehearsalNew',
  'rehearsal-confirmed': 'rehearsalConfirmed',
  'invoice-paid': 'invoicePaid',
  'task-assigned': 'taskAssigned',
  'invite-redeemed': 'inviteRedeemed',
}

// Cross-tenant profile pictures use the membership-authorized notification
// endpoint. The generic app logo is the fallback when no picture is uploaded.
function tenantAvatarSrc(
  tenantId: number,
  avatarPath: string | null,
): string {
  if (!avatarPath) return '/share/logo.png'
  return `/api/notifications/tenant-avatar/${tenantId}`
}

export default function NotificationSettingsSection() {
  const { t } = useTranslation('notifications')
  const { status: pushStatus, subscribe, unsubscribe } = usePushNotifications()
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const compact = useCompactLayout()

  useEffect(() => {
    getNotificationPrefs().then(setPrefs).catch(() => { })
  }, [])

  const pushDisabled = pushStatus === 'denied' || pushStatus === 'unsupported' || pushStatus === 'loading'

  const handlePushToggle = () => {
    if (pushStatus === 'subscribed') void unsubscribe()
    else void subscribe()
  }

  const saveTypePref = (type: string, enabled: boolean) => {
    setPrefs((p) => p && {
      ...p,
      types: p.types.map((entry) => (entry.type === type ? { ...entry, enabled } : entry)),
    })
    updateNotificationPrefs({ types: [{ type, enabled }] })
      .then(setPrefs)
      .catch(() => { })
  }

  const saveTenantPref = (tenantId: number, enabled: boolean) => {
    setPrefs((p) => p && {
      ...p,
      tenants: p.tenants.map((entry) => (entry.tenantId === tenantId ? { ...entry, enabled } : entry)),
    })
    updateNotificationPrefs({ tenants: [{ tenantId, enabled }] })
      .then(setPrefs)
      .catch(() => { })
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
          {t($ => $.settings.push.title)}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          {t($ => $.settings.push.description)}
        </Typography>
        <Box sx={{ display: 'flex', ml: 2, flexDirection: 'column' }}>
          <FormControlLabel
            control={
              <Switch
                sx={{ mr: 1 }}
                checked={pushStatus === 'subscribed'}
                disabled={pushDisabled}
                onChange={handlePushToggle}
              />
            }
            label={t($ => $.settings.push.label)}
          />
          {pushStatus === 'denied' && (
            <Typography variant="caption" sx={{ color: 'warning.main', display: 'block' }}>
              {t($ => $.settings.push.denied)}
            </Typography>
          )}
          {pushStatus === 'unsupported' && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              {t($ => $.settings.push.unsupported)}
            </Typography>
          )}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
          {t($ => $.settings.types.title)}
        </Typography>

        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          {t($ => $.settings.types.description)}
        </Typography>

        <Box sx={{ display: 'flex', ml: 2, flexDirection: 'column' }}>
          {prefs?.types.map(({ type, enabled }) => {
            const labelKey = TYPE_LABEL_KEYS[type]
            return (
              <FormControlLabel
                key={type}
                control={
                  <Switch
                    sx={{ mr: 1 }}
                    checked={enabled}
                    onChange={(_e, checked) => saveTypePref(type, checked)}
                  />
                }
                label={labelKey ? t($ => $.settings.types.labels[labelKey]) : type}
              />
            )
          })}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
          {t($ => $.settings.bands.title)}
        </Typography>

        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          {t($ => $.settings.bands.description)}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {prefs?.tenants.map(({ tenantId, tenantName, avatarPath, enabled }, index) => (
            <Box key={tenantId}>
              {index > 0 && <Divider variant="inset" sx={{ my: 0.5 }} />}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FormControlLabel
                  sx={{ flexGrow: 1, ml: 1 }}
                  control={
                    <Switch
                      checked={enabled}
                      onChange={(_e, checked) => saveTenantPref(tenantId, checked)}
                    />
                  }
                  label={
                    <Box sx={{ flexdirection: 'row', alignItems: 'center', display: 'flex', gap: 1 }}>
                      <Avatar
                        src={tenantAvatarSrc(tenantId, avatarPath)}
                        alt=""
                        sx={{ width: 32, height: 32, flexShrink: 0 }}
                      />
                      {tenantName}
                    </Box>
                  }
                />
              </Box>
            </Box>
          ))}
        </Box>
      </Paper>
    </Box>
  )
}
