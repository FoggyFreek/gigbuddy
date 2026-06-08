import { useState } from 'react'
import PropTypes from 'prop-types'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Typography from '@mui/material/Typography'
import GigPicker from './GigPicker.jsx'
import { createInvoice, draftFromGig } from '../api/invoices.js'
import { buildInvoicePayload, emptyDraft } from './invoices/invoiceFormHelpers.js'

export default function NewInvoiceDialog({ onClose, onCreated }) {
  const [gig, setGig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // billing_targets step
  const [billingTargets, setBillingTargets] = useState(null) // null = not loaded yet
  const [pendingPayload, setPendingPayload] = useState(null)
  const [selectedTarget, setSelectedTarget] = useState(null)

  async function createFromDraft(payload) {
    const form = { ...emptyDraft(), ...payload.draft, lines: payload.draft?.lines || [] }
    const created = await createInvoice(buildInvoicePayload(form))
    onCreated(created.id)
  }

  async function handleContinue() {
    if (!gig) return
    try {
      setBusy(true)
      setError(null)
      const payload = await draftFromGig(gig.id)
      if (payload.billing_targets?.length > 1) {
        // Show billing target selection before proceeding
        setBillingTargets(payload.billing_targets)
        setSelectedTarget(payload.billing_targets[0].type)
        setPendingPayload(payload)
      } else {
        await createFromDraft(payload)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleTargetConfirm() {
    if (!pendingPayload || !selectedTarget) return
    const target = billingTargets.find((t) => t.type === selectedTarget)
    if (!target) {
      try {
        setBusy(true)
        setError(null)
        await createFromDraft(pendingPayload)
      } catch (e) {
        setError(e.message)
      } finally {
        setBusy(false)
      }
      return
    }
    // Override customer fields in draft with selected target
    const updated = {
      ...pendingPayload,
      draft: {
        ...pendingPayload.draft,
        customer_name: target.name || '',
        customer_contact_title: target.contact_title || null,
        customer_contact_given_name: target.contact_given_name || null,
        customer_contact_family_name: target.contact_family_name || null,
        customer_address_street: target.address_street || null,
        customer_address_postal_code: target.address_postal_code || null,
        customer_address_city: target.address_city || null,
        customer_address_country: target.address_country || 'NL',
        customer_email: target.email || null,
      },
    }
    try {
      setBusy(true)
      setError(null)
      await createFromDraft(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Step 2: billing target selection
  if (billingTargets) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>Select billing target</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This gig has both a festival and a venue. Choose which organisation to bill.
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <RadioGroup value={selectedTarget} onChange={(e) => setSelectedTarget(e.target.value)}>
            {billingTargets.map((t) => (
              <FormControlLabel
                key={t.type}
                value={t.type}
                control={<Radio />}
                label={
                  <>
                    <Typography variant="body2" fontWeight={600}>
                      {t.type === 'festival' ? 'Festival / event organisation' : 'Venue / physical location'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[t.name, t.address_city].filter(Boolean).join(' · ')}
                    </Typography>
                  </>
                }
              />
            ))}
          </RadioGroup>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => { setBillingTargets(null); setPendingPayload(null) }}>Back</Button>
          <Button variant="contained" disabled={!selectedTarget || busy} onClick={handleTargetConfirm}>
            Continue
          </Button>
        </DialogActions>
      </Dialog>
    )
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New invoice</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Pick a gig to draft the invoice from. The band fee, venue address, and a default line description will be filled in.
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <GigPicker value={gig} onChange={setGig} autoFocus />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={!gig || busy} onClick={handleContinue}>
          Continue
        </Button>
      </DialogActions>
    </Dialog>
  )
}

NewInvoiceDialog.propTypes = {
  onClose: PropTypes.func.isRequired,
  onCreated: PropTypes.func.isRequired,
}
