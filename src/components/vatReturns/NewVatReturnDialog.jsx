import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { previewVatReturn, createVatReturn } from '../../api/vatReturns.js'
import { formatEur } from '../../utils/invoiceTotals.js'
import { formatShortDate } from '../../utils/dateFormat.js'
import { previousQuarter, quarterLabel } from '../../utils/vatReturns.js'

const QUARTERS = [1, 2, 3, 4]

function yearOptions() {
  const current = new Date().getFullYear()
  return [current - 2, current - 1, current]
}

function netLabel(direction) {
  if (direction === 'payable') return 'To pay'
  if (direction === 'receivable') return 'To receive'
  return 'Nothing due'
}

// Picks a quarter, previews the running VAT position (output − input) and
// files the declaration: the backend posts the settlement journal and closes
// the books through the period end.
export default function NewVatReturnDialog({ onFiled, onClose }) {
  const [{ year, quarter }, setPeriod] = useState(() => previousQuarter())
  const [lastPreview, setLastPreview] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Reset the error during render when the period changes (React's
  // adjust-state-on-prop-change pattern); the stale preview needs no reset —
  // it is ignored below until the fetch for the current period lands.
  const [prevPeriod, setPrevPeriod] = useState({ year, quarter })
  if (prevPeriod.year !== year || prevPeriod.quarter !== quarter) {
    setPrevPeriod({ year, quarter })
    setError(null)
  }

  useEffect(() => {
    let active = true
    previewVatReturn(year, quarter)
      .then((p) => active && setLastPreview(p))
      .catch((e) => active && setError(e.message))
    return () => { active = false }
  }, [year, quarter])

  const preview =
    lastPreview?.year === year && lastPreview?.quarter === quarter ? lastPreview : null

  const nothingToSettle = preview?.output_vat_cents === 0 && preview?.input_vat_cents === 0
  const canFile = Boolean(preview) && preview.period_ended && !nothingToSettle && !busy

  async function handleFile() {
    if (!canFile) return
    try {
      setBusy(true)
      setError(null)
      await onFiled(await createVatReturn({ year, quarter }))
      onClose()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>New VAT declaration</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ display: 'flex', gap: 1, mt: 1, mb: 2 }}>
          <TextField
            label="Year"
            size="small"
            select
            fullWidth
            value={year}
            onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
          >
            {yearOptions().map((y) => <MenuItem key={y} value={y}>{y}</MenuItem>)}
          </TextField>
          <TextField
            label="Quarter"
            size="small"
            select
            fullWidth
            value={quarter}
            onChange={(e) => setPeriod((p) => ({ ...p, quarter: Number(e.target.value) }))}
          >
            {QUARTERS.map((q) => <MenuItem key={q} value={q}>Q{q}</MenuItem>)}
          </TextField>
        </Box>

        {!preview && !error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {preview && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {quarterLabel(year, quarter)} · due {formatShortDate(preview.due_date)}
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2">Output VAT (sales)</Typography>
              <Typography variant="body2">{formatEur(preview.output_vat_cents)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2">Input VAT (purchases)</Typography>
              <Typography variant="body2">− {formatEur(preview.input_vat_cents)}</Typography>
            </Box>
            <Divider sx={{ mb: 1 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 2 }}>
              <Typography variant="subtitle2">{netLabel(preview.direction)}</Typography>
              <Typography variant="h6" fontWeight={700}>
                {formatEur(Math.abs(preview.net_cents))}
              </Typography>
            </Box>

            {!preview.period_ended && (
              <Alert severity="info" sx={{ mb: 1 }}>
                This quarter has not ended yet — it can be filed from {formatShortDate(preview.period_to)}.
              </Alert>
            )}
            {preview.period_ended && nothingToSettle && (
              <Alert severity="info" sx={{ mb: 1 }}>No VAT was accumulated in this period.</Alert>
            )}
            {canFile && (
              <Alert severity="warning">
                Filing settles the VAT accounts and closes the books through {formatShortDate(preview.period_to)}.
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={!canFile} onClick={handleFile}>
          Settle quarter
        </Button>
      </DialogActions>
    </Dialog>
  )
}

NewVatReturnDialog.propTypes = {
  onFiled: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
}
