import type { Gig, Id } from '../types/entities.ts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import GigPicker from './GigPicker.tsx'
import { createInvoice, draftFromGig } from '../api/invoices.ts'
import { buildInvoicePayload, emptyDraft } from './invoices/invoiceFormHelpers.ts'
import type { InvoiceFormLine } from './invoices/invoiceFormHelpers.ts'

interface BillingTarget {
  type: string
  name?: string
  address_city?: string
  contact_title?: string | null
  contact_given_name?: string | null
  contact_family_name?: string | null
  address_street?: string | null
  address_postal_code?: string | null
  address_country?: string | null
  email?: string | null
}

interface GigDraftPayload {
  draft?: Record<string, unknown>
  billing_targets?: BillingTarget[]
}

interface NewInvoiceDialogProps {
  onClose: () => void
  onCreated: (id: Id) => void
}

export default function NewInvoiceDialog({ onClose, onCreated }: Readonly<NewInvoiceDialogProps>) {
  const { t } = useTranslation(['invoices', 'common'])
  const [gig, setGig] = useState<Gig | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // billing_targets step
  const [billingTargets, setBillingTargets] = useState<BillingTarget[] | null>(null)
  const [pendingPayload, setPendingPayload] = useState<GigDraftPayload | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)

  async function createFromDraft(payload: GigDraftPayload) {
    const form = { ...emptyDraft(), ...payload.draft, lines: (payload.draft?.lines as InvoiceFormLine[] | undefined) || [] }
    const created = await createInvoice(buildInvoicePayload(form))
    onCreated(created.id!)
  }

  async function handleContinue() {
    if (!gig) return
    try {
      setBusy(true)
      setError(null)
      const payload = await draftFromGig(gig.id!) as unknown as GigDraftPayload
      if (payload.billing_targets && payload.billing_targets.length > 1) {
        // Show billing target selection before proceeding
        setBillingTargets(payload.billing_targets)
        setSelectedTarget(payload.billing_targets[0].type)
        setPendingPayload(payload)
      } else {
        await createFromDraft(payload)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleTargetConfirm() {
    if (!pendingPayload || !selectedTarget) return
    const target = billingTargets?.find((t) => t.type === selectedTarget)
    if (!target) {
      try {
        setBusy(true)
        setError(null)
        await createFromDraft(pendingPayload)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
      return
    }
    // Override customer fields in draft with selected target
    const updated: GigDraftPayload = {
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
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Step 2: billing target selection
  if (billingTargets) {
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{t($ => $.newDialog.selectBillingTarget)}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t($ => $.newDialog.billingTargetDescription)}
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <RadioGroup value={selectedTarget} onChange={(e) => setSelectedTarget(e.target.value)}>
            {billingTargets.map((target) => (
              <FormControlLabel
                key={target.type}
                value={target.type}
                control={<Radio />}
                label={
                  <>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {target.type === 'festival' ? t($ => $.newDialog.festivalTarget) : t($ => $.newDialog.venueTarget)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {[target.name, target.address_city].filter(Boolean).join(' · ')}
                    </Typography>
                  </>
                }
              />
            ))}
          </RadioGroup>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => { setBillingTargets(null); setPendingPayload(null) }}>{t($ => $.common.actions.back)}</Button>
          <Button variant="contained" disabled={!selectedTarget || busy} onClick={handleTargetConfirm}>
            {t($ => $.newDialog.continue)}
          </Button>
        </DialogActions>
      </Dialog>
    )
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t($ => $.newDialog.title)}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t($ => $.newDialog.description)}
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <GigPicker value={gig} onChange={setGig} autoFocus />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button>
        <Button variant="contained" disabled={!gig || busy} onClick={handleContinue}>
          {t($ => $.newDialog.continue)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
