import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import {
  listTaxSchemeEnrolments,
  startTaxSchemeEnrolment,
  updateTaxSchemeEnrolment,
  voidTaxSchemeEnrolment,
} from '../../../../finance/vat/taxSchemesApi.ts'
import { getAccountingProfile } from '../../../../finance/accounting-profile/accountingProfile.ts'
import { useAccountingProfile } from '../../../../contexts/accountingProfileContext.ts'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'
import { formatShortDate } from '../../../../utils/dateFormat.ts'
import VatSchemeDialog from './VatSchemeDialog.tsx'
import type { VatSchemeDraft } from './VatSchemeDialog.tsx'
import type { TaxSchemeEnrolment } from '../../../../types/entities.ts'

// Server error codes this editor can produce. Anything else falls back to the
// generic message rather than rendering a raw server string.
const KNOWN_ERROR_CODES = [
  'invalid_scheme_code',
  'scheme_country_mismatch',
  'invalid_country_code',
  'invalid_valid_from',
  'invalid_valid_to',
  'valid_to_before_valid_from',
  'invalid_source_confirmation_date',
  'overlapping_enrolment',
  'scheme_requires_vat_registration',
  'enrolment_confirmed',
  'enrolment_referenced',
  'enrolment_voided',
  'nothing_to_update',
] as const

type KnownErrorCode = typeof KNOWN_ERROR_CODES[number]

function isKnownErrorCode(code: string): code is KnownErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code)
}

// The band's VAT scheme history: which small-business or cross-border regime
// applied, and between which dates.
//
// Editing this NEVER changes an invoice that has already been issued — those
// carry the treatment that was frozen onto them when they were sent. Which is
// exactly why correcting a wrong start date here is safe, and why the copy says
// so: a user who thinks otherwise will not fix a date they know is wrong.
export default function VatSchemeEnrolments() {
  const { t, i18n } = useTranslation('settings')
  const { profile, applyProfile } = useAccountingProfile()
  const compact = useCompactLayout()

  const [enrolments, setEnrolments] = useState<TaxSchemeEnrolment[] | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TaxSchemeEnrolment | null>(null)
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setEnrolments(await listTaxSchemeEnrolments())
    // Starting or ending a scheme changes the profile's derived filing frequency
    // and its completeness, so the shared profile has to be republished.
    applyProfile(await getAccountingProfile())
  }, [applyProfile])

  useEffect(() => {
    let cancelled = false
    listTaxSchemeEnrolments()
      .then((rows) => { if (!cancelled) setEnrolments(rows) })
      .catch(() => { if (!cancelled) setEnrolments([]) })
    return () => { cancelled = true }
  }, [])

  function describeError(err: unknown): string {
    const e = err as { code?: string; message?: string }
    const code = e.code ?? e.message ?? ''
    return isKnownErrorCode(code)
      ? t($ => $.accountingProfile.errors[code])
      : e.message ?? t($ => $.accountingProfile.errors.unknown)
  }

  async function submit(draft: VatSchemeDraft) {
    setSaving(true)
    setDialogError(null)
    try {
      if (editing) {
        await updateTaxSchemeEnrolment(Number(editing.id), {
          valid_from: draft.valid_from,
          valid_to: draft.valid_to,
          source_confirmation_date: draft.source_confirmation_date,
        })
      } else {
        await startTaxSchemeEnrolment(draft)
      }
      await reload()
      setDialogOpen(false)
    } catch (err) {
      setDialogError(describeError(err))
    } finally {
      setSaving(false)
    }
  }

  async function retract(enrolment: TaxSchemeEnrolment) {
    setListError(null)
    try {
      await voidTaxSchemeEnrolment(Number(enrolment.id))
      await reload()
    } catch (err) {
      setListError(describeError(err))
    }
  }

  function openNew() {
    setEditing(null)
    setDialogError(null)
    setDialogOpen(true)
  }

  function openEdit(enrolment: TaxSchemeEnrolment) {
    setEditing(enrolment)
    setDialogError(null)
    setDialogOpen(true)
  }

  const locale = i18n.language
  const fmt = (value: string | null) => (value ? formatShortDate(value, locale) : '—')

  if (!profile || enrolments === null) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {t($ => $.accountingProfile.vatScheme.title)}
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={openNew}>
          {t($ => $.accountingProfile.vatScheme.start)}
        </Button>
      </Stack>

      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t($ => $.accountingProfile.vatScheme.description)}
      </Typography>

      {listError && <Alert severity="error">{listError}</Alert>}

      {enrolments.length === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t($ => $.accountingProfile.vatScheme.empty)}
        </Typography>
      )}

      {enrolments.length > 0 && (compact
        ? (
          <Stack spacing={1}>
            {enrolments.map((e) => (
              <Paper key={e.id} variant="outlined" sx={{ p: 1.5 }}>
                <EnrolmentSummary enrolment={e} fmt={fmt} t={t} />
                <EnrolmentActions enrolment={e} onEdit={openEdit} onVoid={retract} t={t} />
              </Paper>
            ))}
          </Stack>
        )
        : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t($ => $.accountingProfile.vatScheme.scheme)}</TableCell>
                <TableCell>{t($ => $.accountingProfile.vatScheme.validFrom)}</TableCell>
                <TableCell>{t($ => $.accountingProfile.vatScheme.validTo)}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {enrolments.map((e) => (
                <TableRow key={e.id} sx={e.voided_at ? { opacity: 0.55 } : undefined}>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography
                        variant="body2"
                        sx={e.voided_at ? { textDecoration: 'line-through' } : undefined}
                      >
                        {e.scheme_label}
                      </Typography>
                      <EnrolmentChips enrolment={e} t={t} />
                    </Stack>
                  </TableCell>
                  <TableCell>{fmt(e.valid_from)}</TableCell>
                  <TableCell>
                    {e.valid_to ? fmt(e.valid_to) : t($ => $.accountingProfile.vatScheme.open)}
                  </TableCell>
                  <TableCell align="right">
                    <EnrolmentActions enrolment={e} onEdit={openEdit} onVoid={retract} t={t} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}

      {/* Mounted only while open so the form seeds from props and never carries
          a previous edit over — see VatSchemeDialog. */}
      {dialogOpen && (
        <VatSchemeDialog
          homeCountry={profile.country_code}
          enrolment={editing}
          saving={saving}
          error={dialogError}
          onClose={() => setDialogOpen(false)}
          onSubmit={submit}
        />
      )}
    </Stack>
  )
}

type Translate = ReturnType<typeof useTranslation<'settings'>>['t']

// `legacy_inferred` is the one a user must act on: the migration could prove the
// band was on the scheme, never since when.
function EnrolmentChips({ enrolment, t }: { enrolment: TaxSchemeEnrolment; t: Translate }) {
  return (
    <>
      {enrolment.status === 'legacy_inferred' && !enrolment.voided_at && (
        <Chip size="small" color="warning" variant="outlined"
          label={t($ => $.accountingProfile.vatScheme.inferred)} />
      )}
      {!enrolment.scheme_implemented && !enrolment.voided_at && (
        <Chip size="small" variant="outlined"
          label={t($ => $.accountingProfile.vatScheme.recordedOnly)} />
      )}
      {enrolment.scheme_scope === 'eu_sme_destination' && (
        <Chip size="small" variant="outlined"
          label={`${t($ => $.accountingProfile.vatScheme.destination)}: ${enrolment.country_code.toUpperCase()}`} />
      )}
      {enrolment.voided_at && (
        <Chip size="small" variant="outlined"
          label={t($ => $.accountingProfile.vatScheme.voided)} />
      )}
    </>
  )
}

function EnrolmentSummary({ enrolment, fmt, t }: {
  enrolment: TaxSchemeEnrolment
  fmt: (v: string | null) => string
  t: Translate
}) {
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{enrolment.scheme_label}</Typography>
        <EnrolmentChips enrolment={enrolment} t={t} />
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {fmt(enrolment.valid_from)} — {enrolment.valid_to
          ? fmt(enrolment.valid_to)
          : t($ => $.accountingProfile.vatScheme.open)}
      </Typography>
    </Stack>
  )
}

// Voiding, not deleting: a recorded enrolment is the evidence explaining why an
// issued invoice's VAT looks the way it does, so it is retracted rather than
// erased.
function EnrolmentActions({ enrolment, onEdit, onVoid, t }: {
  enrolment: TaxSchemeEnrolment
  onEdit: (e: TaxSchemeEnrolment) => void
  onVoid: (e: TaxSchemeEnrolment) => void
  t: Translate
}) {
  if (enrolment.voided_at) return null
  return (
    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
      <Button size="small" onClick={() => onEdit(enrolment)}>
        {t($ => $.accountingProfile.vatScheme.edit)}
      </Button>
      <Button size="small" color="error" onClick={() => onVoid(enrolment)}>
        {t($ => $.accountingProfile.vatScheme.retract)}
      </Button>
    </Stack>
  )
}
