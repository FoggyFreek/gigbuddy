import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Typography from '@mui/material/Typography'
import { getRemovalPreview, removeMyBand } from '../myBands.ts'
import type { RemovalMode } from '../myBands.ts'
import type { MyBand, MyBandEventCounts } from '../../../types/entities.ts'

const totalOf = (counts: MyBandEventCounts) => counts.gigs + counts.rehearsals + counts.bandEvents

interface RemoveMyBandDialogProps {
  band: MyBand
  onClose: () => void
  onRemoved: () => void
}

/**
 * Removing a band from the collection. KEEP is the default and the events are
 * only unlinked; deleting them is destructive, irreversible, and therefore
 * always a second, explicit confirmation.
 */
export default function RemoveMyBandDialog({ band, onClose, onRemoved }: Readonly<RemoveMyBandDialogProps>) {
  const { t } = useTranslation(['myBands', 'common'])
  const [counts, setCounts] = useState<MyBandEventCounts | null>(null)
  const [mode, setMode] = useState<RemovalMode>('keep')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Read fresh rather than trusting the list row: the counts drive an
  // irreversible choice, so they should describe the state being acted on.
  useEffect(() => {
    let cancelled = false
    getRemovalPreview(band.id)
      .then((preview) => { if (!cancelled) setCounts(preview) })
      .catch(() => { if (!cancelled) setCounts(band.eventCounts) })
    return () => { cancelled = true }
  }, [band.id, band.eventCounts])

  const total = counts === null ? null : totalOf(counts)

  async function handleRemove() {
    if (mode === 'delete' && !confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await removeMyBand(band.id, mode)
      onRemoved()
    } catch (e) {
      setError(e instanceof Error ? e.message : t($ => $.errors.removeFailed))
      setBusy(false)
    }
  }

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={busy ? undefined : onClose}>
      <DialogTitle>{t($ => $.remove.title, { name: band.bandProfile.name })}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography sx={{ mb: 2 }}>{t($ => $.remove.body)}</Typography>

        {total === null && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>
        )}

        {total === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.remove.noEvents)}
          </Typography>
        )}

        {total !== null && total > 0 && (
          <>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {t($ => $.remove.linked, { count: total })}
            </Typography>
            <RadioGroup
              value={mode}
              onChange={(e) => { setMode(e.target.value as RemovalMode); setConfirmingDelete(false) }}
            >
              <FormControlLabel
                value="keep"
                control={<Radio />}
                label={(
                  <Box>
                    <Typography variant="body2">{t($ => $.remove.keep)}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t($ => $.remove.keepHint)}
                    </Typography>
                  </Box>
                )}
              />
              <FormControlLabel
                value="delete"
                control={<Radio />}
                label={(
                  <Box>
                    <Typography variant="body2">{t($ => $.remove.delete)}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {t($ => $.remove.deleteHint)}
                    </Typography>
                  </Box>
                )}
              />
            </RadioGroup>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button>
        <Button
          variant="contained"
          color={mode === 'delete' ? 'error' : 'primary'}
          disabled={busy || total === null}
          onClick={handleRemove}
        >
          {mode === 'delete' && confirmingDelete
            ? t($ => $.remove.confirmDelete, { count: total ?? 0 })
            : t($ => $.remove.confirm)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
