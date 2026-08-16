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
import { downgradePreview } from '../../../commerce/billing/billing.ts'
import type {
  DowngradeBlocker, DowngradePreview, DowngradeTarget, SubscriptionPlan,
} from '../../../commerce/billing/billing.ts'
import type { PlanAudience } from '../../../auth/planAudiences.ts'
import { planFeatureKey } from '../../../commerce/billing/planFeatureKey.ts'
import { formatEur } from '../../invoices/invoiceTotals.ts'

interface DowngradeDialogProps {
  open: boolean
  audience: PlanAudience
  /** null when the module is being removed altogether. */
  plan: SubscriptionPlan | null
  isTrial: boolean
  onClose: () => void
  onConfirm: (confirmation: string) => Promise<void>
}

const LIMIT_LABEL_KEYS = {
  storage_mb: 'storage_mb',
  members: 'members',
  bands: 'bands',
} as const

// Type-to-confirm downgrade or removal. On open it fetches the server-side
// preview: the exact features whose data would be purged, the limit snapshot
// that binds immediately, any capacity blockers (which disable confirming — the
// server re-checks under locks anyway), and what the subscription will cost
// afterwards.
//
// Timing is the thing the copy has to be honest about: on a paid cycle nothing
// changes and nothing is deleted until the next renewal is paid; on a trial the
// change is immediate because there is nothing paid for to honour.
export default function DowngradeDialog({
  open, audience, plan, isTrial, onClose, onConfirm,
}: Readonly<DowngradeDialogProps>) {
  const { t } = useTranslation(['billing', 'common'])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const isRemoval = plan === null
  const target: DowngradeTarget = isRemoval
    ? { audience, remove: true }
    : { audience, planId: plan.id }

  // The preview is keyed by what it was fetched for, so a stale result is
  // simply not current rather than something an effect has to clear.
  const previewKey = open ? `${audience}|${plan?.id ?? 'remove'}` : null
  const [previewState, setPreviewState] = useState<{
    key: string; preview: DowngradePreview | null; failed: boolean
  } | null>(null)
  const currentPreview = previewKey != null && previewState?.key === previewKey ? previewState : null
  const preview = currentPreview?.preview ?? null
  const previewFailed = currentPreview?.failed ?? false

  // The confirmation phrase is a server-side token — deliberately not localized.
  const phrase = isRemoval ? `remove ${audience}` : `downgrade to ${plan.slug}`
  const matches = text.trim().toLowerCase() === phrase

  useEffect(() => {
    if (previewKey == null) return
    let cancelled = false
    downgradePreview(target)
      .then((p) => { if (!cancelled) setPreviewState({ key: previewKey, preview: p, failed: false }) })
      .catch(() => { if (!cancelled) setPreviewState({ key: previewKey, preview: null, failed: true }) })
    return () => { cancelled = true }
    // `target` is rebuilt each render; previewKey is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey])

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
      <DialogTitle>
        {isRemoval
          ? t($ => $.downgrade.removeTitle, { module: t($ => $.modules[audience]) })
          : t($ => $.downgrade.title, { plan: plan.name })}
      </DialogTitle>
      <DialogContent>
        {isTrial ? (
          <Alert severity="warning" sx={{ mb: 2 }}>{t($ => $.downgrade.trialInfo)}</Alert>
        ) : (
          preview?.effectiveAt != null && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t($ => $.downgrade.scheduledInfo, { date: new Date(preview.effectiveAt) })}
            </Alert>
          )
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

        {preview?.nextSnapshot != null && (
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t($ => $.downgrade.newPrice, { price: formatEur(preview.nextSnapshot.totalCents) })}
          </Typography>
        )}

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
            values={{ phrase }}
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
        {/* !preview: never allow confirming a destructive change without the
            loaded purge preview — informed consent is the point of this dialog. */}
        <Button onClick={() => { void handleConfirm() }} color="error" variant="contained" disabled={!matches || busy || blocked || !preview}>
          {t($ => $.downgrade.confirm)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
