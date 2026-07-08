import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { downgradePreview } from '../../api/billing.ts'
import type { BillingInterval, DowngradeBlocker, DowngradePreview, SubscriptionPlan } from '../../api/billing.ts'
import { planFeatureKey } from '../../utils/planFeatureKey.ts'

interface DowngradeDialogProps {
  open: boolean
  plan: SubscriptionPlan | null
  interval: BillingInterval
  isFreeFallback: boolean
  onClose: () => void
  onConfirm: (confirmation: string) => Promise<void>
}

const LIMIT_LABEL_KEYS = {
  storage_mb: 'storage_mb',
  members: 'members',
  bands: 'bands',
} as const

// Type-to-confirm downgrade. On open it fetches the server-side preview: the
// exact features whose data would be purged, the limit snapshot that will
// bind immediately, and any capacity blockers (which disable confirming — the
// server re-checks under locks anyway). The two target kinds behave
// differently at period end, and the copy makes that explicit before the user
// commits:
//   - free fallback: the subscription cancels and the removed features' data is
//     purged at period end.
//   - paid lower tier: access fallback-locks until the first lower-tier charge
//     settles (SEPA can take days), then the tier switches — nothing is purged
//     until that charge is confirmed paid.
export default function DowngradeDialog({ open, plan, interval, isFreeFallback, onClose, onConfirm }: Readonly<DowngradeDialogProps>) {
  const { t } = useTranslation(['billing', 'common'])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<DowngradePreview | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  // The confirmation phrase is a server-side token built from the slug — it is
  // deliberately not localized.
  const phrase = plan ? `downgrade to ${plan.slug}` : ''
  const matches = text.trim().toLowerCase() === phrase

  useEffect(() => {
    if (!open || !plan) {
      setPreview(null)
      setPreviewFailed(false)
      return
    }
    let cancelled = false
    downgradePreview(plan.id, interval)
      .then((p) => { if (!cancelled) setPreview(p) })
      .catch(() => { if (!cancelled) setPreviewFailed(true) })
    return () => { cancelled = true }
  }, [open, plan, interval])

  const blockers = preview?.blockers ?? []
  const purgedFeatures = preview?.features ?? []
  const previewLoading = open && !preview && !previewFailed
  const blocked = blockers.length > 0

  const handleConfirm = async () => {
    if (!matches || blocked || !preview) return
    setBusy(true)
    try {
      await onConfirm(text.trim())
      setText('')
    } finally {
      setBusy(false)
    }
  }

  const handleClose = () => {
    if (busy) return
    setText('')
    onClose()
  }

  const featureLabel = (feature: string) => {
    const key = planFeatureKey(feature)
    return key ? t($ => $.features[key]) : feature.replace(/_/g, ' ')
  }

  const limitLabel = (limit: string) =>
    limit in LIMIT_LABEL_KEYS
      ? t($ => $.limits[LIMIT_LABEL_KEYS[limit as keyof typeof LIMIT_LABEL_KEYS]])
      : limit

  const blockerName = (blocker: DowngradeBlocker) =>
    blocker.tenantName ?? t($ => $.downgrade.blockerBands)

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t($ => $.downgrade.title, { plan: plan?.name })}</DialogTitle>
      <DialogContent>
        {isFreeFallback ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t($ => $.downgrade.freeFallbackWarning)}
          </Alert>
        ) : (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t($ => $.downgrade.paidLowerInfo, { plan: plan?.name })}
          </Alert>
        )}

        {previewLoading && (
          <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, color: 'text.secondary' }}>
            <CircularProgress size={16} /> {t($ => $.downgrade.previewLoading)}
          </Typography>
        )}
        {previewFailed && (
          <Alert severity="error" sx={{ mb: 2 }}>{t($ => $.downgrade.previewError)}</Alert>
        )}

        {preview && (purgedFeatures.length > 0 ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            <AlertTitle>{t($ => $.downgrade.willDelete)}</AlertTitle>
            <List dense disablePadding>
              {purgedFeatures.map((feature) => (
                <ListItem key={feature} disableGutters sx={{ py: 0 }}>
                  <ListItemText primary={featureLabel(feature)} slotProps={{ primary: { variant: 'body2' } }} />
                </ListItem>
              ))}
            </List>
          </Alert>
        ) : (
          <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
            {t($ => $.downgrade.nothingDeleted)}
          </Typography>
        ))}

        {blocked && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            <AlertTitle>{t($ => $.downgrade.blockersTitle)}</AlertTitle>
            <List dense disablePadding>
              {blockers.map((blocker) => (
                <ListItem key={`${blocker.tenantId ?? 'user'}:${blocker.limit}`} disableGutters sx={{ py: 0 }}>
                  <ListItemText
                    primary={t($ => $.downgrade.blockerLine, {
                      name: blockerName(blocker),
                      limit: limitLabel(blocker.limit),
                      current: blocker.current,
                      target: blocker.target,
                    })}
                    slotProps={{ primary: { variant: 'body2' } }}
                  />
                </ListItem>
              ))}
            </List>
          </Alert>
        )}

        <DialogContentText sx={{ mb: 2 }}>
          <Trans
            t={t}
            i18nKey={($) => $.downgrade.confirmPrompt}
            values={{ plan: plan?.name, phrase }}
            components={{
              mono: <Typography component="span" sx={{ fontFamily: 'monospace', fontWeight: 600 }} />,
            }}
          />
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={phrase}
          disabled={blocked}
          slotProps={{ htmlInput: { 'aria-label': t($ => $.downgrade.confirmAria) } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
        {/* !preview: never allow confirming a destructive downgrade without the
            loaded purge preview — informed consent is the point of this dialog. */}
        <Button onClick={() => { void handleConfirm() }} color="error" variant="contained" disabled={!matches || busy || blocked || !preview}>
          {t($ => $.downgrade.confirm)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
