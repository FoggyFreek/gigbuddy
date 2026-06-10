import { useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DateEntryField from '../DateEntryField.jsx'
import { listMemberPurchases } from '../../api/reimbursements.js'
import { formatEur } from '../../utils/purchaseTotals.js'
import { memberOutstandingShape } from '../../propTypes/shared.js'

// Registers a reimbursement that settles whole member-paid purchases. Loads the
// member's outstanding purchases, lets you deselect some (all selected by
// default), shows the resulting total, and posts on submit. Amount is derived
// from the selection — never free-entered — so it always matches the cleared
// liability.
export default function RegisterReimbursementDialog({ member, onSubmit, onClose }) {
  const [purchases, setPurchases] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    listMemberPurchases(member.band_member_id)
      .then((rows) => {
        if (!active) return
        setPurchases(rows)
        setSelected(new Set(rows.map((p) => p.id)))
      })
      .catch((e) => active && setError(e.message))
    return () => { active = false }
  }, [member.band_member_id])

  const total = useMemo(() => {
    if (!purchases) return 0
    return purchases.reduce((sum, p) => (selected.has(p.id) ? sum + p.total_cents : sum), 0)
  }, [purchases, selected])

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canSubmit = selected.size > 0 && Boolean(paidOn) && !busy

  async function handleSubmit() {
    if (!canSubmit) return
    try {
      setBusy(true)
      setError(null)
      await onSubmit({
        band_member_id: member.band_member_id,
        purchase_ids: [...selected],
        paid_on: paidOn,
        memo: memo.trim() || null,
      })
      onClose()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Reimburse {member.band_member_name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {purchases === null && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {purchases && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Purchases to settle
            </Typography>
            {purchases.map((p) => (
              <FormControlLabel
                key={p.id}
                sx={{ display: 'flex', mr: 0, justifyContent: 'space-between' }}
                labelPlacement="start"
                control={<Checkbox checked={selected.has(p.id)} onChange={() => toggle(p.id)} />}
                label={
                  <Box>
                    <Typography variant="body2">#{p.receipt_number} · {p.supplier_name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {p.description || ''} · {formatEur(p.total_cents)}
                    </Typography>
                  </Box>
                }
              />
            ))}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mt: 1, mb: 2 }}>
              <Typography variant="subtitle2">Total</Typography>
              <Typography variant="h6" fontWeight={700}>{formatEur(total)}</Typography>
            </Box>

            <Box sx={{ mb: 2 }}>
              <DateEntryField
                label="Paid on"
                size="small"
                fullWidth
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </Box>
            <TextField
              label="Memo"
              size="small"
              fullWidth
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={!canSubmit} onClick={handleSubmit}>
          Register reimbursement
        </Button>
      </DialogActions>
    </Dialog>
  )
}

RegisterReimbursementDialog.propTypes = {
  member: memberOutstandingShape.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
}
