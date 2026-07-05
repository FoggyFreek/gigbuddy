import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { SubscriptionPlan } from '../../api/billing.ts'

interface DowngradeDialogProps {
  open: boolean
  plan: SubscriptionPlan | null
  isFreeFallback: boolean
  onClose: () => void
  onConfirm: (confirmation: string) => Promise<void>
}

// Type-to-confirm downgrade. The two target kinds behave differently at period
// end, and the copy makes that explicit before the user commits:
//   - free fallback: the subscription cancels and the removed features' data is
//     purged at period end.
//   - paid lower tier: access fallback-locks until the first lower-tier charge
//     settles (SEPA can take days), then the tier switches — nothing is purged
//     until that charge is confirmed paid.
export default function DowngradeDialog({ open, plan, isFreeFallback, onClose, onConfirm }: Readonly<DowngradeDialogProps>) {
  const { t } = useTranslation(['billing', 'common'])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  // The confirmation phrase is a server-side token built from the slug — it is
  // deliberately not localized.
  const phrase = plan ? `downgrade to ${plan.slug}` : ''
  const matches = text.trim().toLowerCase() === phrase

  const handleConfirm = async () => {
    if (!matches) return
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
          slotProps={{ htmlInput: { 'aria-label': t($ => $.downgrade.confirmAria) } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
        <Button onClick={() => { void handleConfirm() }} color="error" variant="contained" disabled={!matches || busy}>
          {t($ => $.downgrade.confirm)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
