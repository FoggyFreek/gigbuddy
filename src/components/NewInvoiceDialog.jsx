import { useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import GigPicker from './GigPicker.jsx'
import { draftFromGig } from '../api/invoices.js'

export default function NewInvoiceDialog({ onClose, onDraftReady }) {
  const [gig, setGig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleContinue() {
    if (!gig) return
    try {
      setBusy(true)
      setError(null)
      const payload = await draftFromGig(gig.id)
      onDraftReady(payload)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New invoice</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Pick a gig to draft the invoice from. The band fee, venue address, and a default line description will be filled in.
        </Typography>
        <GigPicker value={gig} onChange={setGig} autoFocus />
        {error && (
          <Typography color="error" sx={{ mt: 1 }}>{error}</Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!gig || busy} onClick={handleContinue}>
          Continue
        </Button>
      </DialogActions>
    </Dialog>
  )
}
