import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { getTaxScheme, getTaxSchemes } from '../../utils/taxSchemes.ts'
import { VAT_COUNTRY_CODES } from '../../utils/vatRates.ts'
import type { TaxSchemeEnrolment } from '../../types/entities.ts'

export interface VatSchemeDraft {
  scheme_code: string
  country_code: string
  valid_from: string
  valid_to: string | null
  source_confirmation_date: string | null
}

interface Props {
  /** The band's accounting country — a national scheme is always recorded against it. */
  homeCountry: string
  /** Editing an existing enrolment, or null to start a new one. */
  enrolment: TaxSchemeEnrolment | null
  saving: boolean
  error: string | null
  onClose: () => void
  onSubmit: (draft: VatSchemeDraft) => void
}

const today = () => new Date().toISOString().slice(0, 10)

// Start or correct one enrolment period. Only the scheme and its dates are
// asked: a different scheme is a different enrolment, not an edit of this one,
// which is why the picker is disabled once a row exists.
//
// The parent MOUNTS this only while the dialog is open, so the fields seed
// themselves from props on mount and a previous edit can never leak into the
// next one — no effect re-seeding state, which would be a cascading render.
export default function VatSchemeDialog({
  homeCountry, enrolment, saving, error, onClose, onSubmit,
}: Props) {
  const { t } = useTranslation('settings')
  const schemes = getTaxSchemes(homeCountry)

  const [schemeCode, setSchemeCode] = useState(
    () => enrolment?.scheme_code ?? schemes[0]?.code ?? '',
  )
  const [country, setCountry] = useState(() => enrolment?.country_code ?? homeCountry)
  const [validFrom, setValidFrom] = useState(() => enrolment?.valid_from ?? today())
  const [validTo, setValidTo] = useState(() => enrolment?.valid_to ?? '')
  const [confirmationDate, setConfirmationDate] = useState(
    () => enrolment?.source_confirmation_date ?? '',
  )

  const scheme = getTaxScheme(schemeCode)
  const perDestination = Boolean(scheme?.perDestination)
  const rangeInvalid = validTo !== '' && validTo < validFrom

  function submit() {
    onSubmit({
      scheme_code: schemeCode,
      country_code: perDestination ? country : homeCountry,
      valid_from: validFrom,
      valid_to: validTo || null,
      source_confirmation_date: confirmationDate || null,
    })
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {enrolment
          ? t($ => $.accountingProfile.vatScheme.editTitle)
          : t($ => $.accountingProfile.vatScheme.startTitle)}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            select
            id="vat-scheme-code"
            label={t($ => $.accountingProfile.vatScheme.scheme)}
            fullWidth
            size="small"
            // A recorded enrolment's scheme is a fact about a past period; changing
            // it would rewrite what the band was on, not correct this row.
            disabled={saving || Boolean(enrolment)}
            value={schemeCode}
            onChange={(e) => setSchemeCode(e.target.value)}
          >
            {schemes.map((option) => (
              <MenuItem key={option.code} value={option.code}>{option.label}</MenuItem>
            ))}
          </TextField>

          {/* Only the cross-border scheme has a destination to pick: a national
              scheme is always the band's own jurisdiction. */}
          {perDestination && (
            <TextField
              select
              id="vat-scheme-country"
              label={t($ => $.accountingProfile.vatScheme.destinationCountry)}
              fullWidth
              size="small"
              disabled={saving || Boolean(enrolment)}
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              helperText={t($ => $.accountingProfile.vatScheme.destinationCountryHelper)}
            >
              {VAT_COUNTRY_CODES.filter((code) => code !== homeCountry).map((code) => (
                <MenuItem key={code} value={code}>{code.toUpperCase()}</MenuItem>
              ))}
            </TextField>
          )}

          {scheme && !scheme.implemented && (
            <Alert severity="warning">
              {t($ => $.accountingProfile.vatScheme.notImplemented)}
            </Alert>
          )}
          {scheme?.perDestination && (
            <Alert severity="info">
              {t($ => $.accountingProfile.vatScheme.destinationOnlyNote)}
            </Alert>
          )}

          <TextField
            id="vat-scheme-valid-from"
            type="date"
            label={t($ => $.accountingProfile.vatScheme.validFrom)}
            fullWidth
            size="small"
            disabled={saving}
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText={t($ => $.accountingProfile.vatScheme.validFromHelper)}
          />

          <TextField
            id="vat-scheme-valid-to"
            type="date"
            label={t($ => $.accountingProfile.vatScheme.validTo)}
            fullWidth
            size="small"
            disabled={saving}
            value={validTo}
            onChange={(e) => setValidTo(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            error={rangeInvalid}
            // Spelled out because the inclusive reading is the one tax
            // authorities use, and the opposite guess is silently wrong by a day.
            helperText={rangeInvalid
              ? t($ => $.accountingProfile.errors.valid_to_before_valid_from)
              : t($ => $.accountingProfile.vatScheme.validToHelper)}
          />

          <TextField
            id="vat-scheme-confirmation-date"
            type="date"
            label={t($ => $.accountingProfile.vatScheme.confirmationDate)}
            fullWidth
            size="small"
            disabled={saving}
            value={confirmationDate}
            onChange={(e) => setConfirmationDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText={t($ => $.accountingProfile.vatScheme.confirmationDateHelper)}
          />

          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.accountingProfile.vatScheme.issuedUnaffected)}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t($ => $.accountingProfile.vatScheme.cancel)}
        </Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={saving || !schemeCode || !validFrom || rangeInvalid}
        >
          {t($ => $.accountingProfile.vatScheme.save)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
