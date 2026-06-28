import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { getLedgerEntry, voidLedgerEntry, reverseLedgerEntry } from '../api/ledger.ts'
import { createJournal } from '../api/journal.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { formatEur } from '../utils/invoiceTotals.ts'
import { formatShortDate } from '../utils/dateFormat.ts'
import MoneyCells, { MoneyHeaderCells } from '../components/shared/MoneyCells.tsx'
import type { LedgerLine, Id } from '../types/entities.ts'

const decimalEur = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Signed net per line for the "In EUR" column: debits positive, credits negative.
function formatSigned(line: LedgerLine) {
  return decimalEur.format(((line.debit_cents ?? 0) - (line.credit_cents ?? 0)) / 100)
}

interface LedgerEntry {
  id?: Id
  entry_date?: string
  description?: string
  receipt?: number | string | null
  created_at?: string
  created_by_name?: string
  voided?: boolean
  period_open?: boolean
  voided_by_transaction_id?: Id | null
  reversed_by_transaction_id?: Id | null
  corrects_transaction_id?: Id | null
  lines?: LedgerLine[]
  origin?: { path?: string; label?: string } | null
}

export default function LedgerEntryDetailPage() {
  const { t } = useTranslation(['ledger', 'common'])
  const navigate = useNavigate()
  const { id } = useParams()
  const [entry, setEntry] = useState<LedgerEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [voidOpen, setVoidOpen] = useState(false)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setEntry(null)
    setActionError(null)
    getLedgerEntry(Number(id))
      .then((data) => { if (!cancelled) setEntry(data as LedgerEntry) })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [id])

  async function confirmVoid() {
    if (!entry?.id) return
    setBusy(true)
    setActionError(null)
    try {
      const result = await voidLedgerEntry(entry.id)
      setVoidOpen(false)
      navigate(`/ledger/${(result as LedgerEntry).id}`)
    } catch (e) {
      setVoidOpen(false)
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function confirmReverse() {
    if (!entry?.id) return
    setBusy(true)
    setActionError(null)
    try {
      const result = await reverseLedgerEntry(entry.id)
      setReverseOpen(false)
      navigate(`/ledger/${(result as LedgerEntry).id}`)
    } catch (e) {
      setReverseOpen(false)
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Copies the entry's raw lines into a draft journal (gross amounts, no VAT
  // split — the lines already are the final ledger legs).
  async function copyToJournal() {
    if (!entry?.lines) return
    setBusy(true)
    setActionError(null)
    try {
      await createJournal({
        description: entry.description || null,
        lines: entry.lines.map((l) => ({
          description: l.memo,
          account_code: l.account_code,
          vat_rate: 0,
          side: (l.debit_cents ?? 0) > 0 ? 'debit' : 'credit',
          amount_cents: (l.debit_cents ?? 0) > 0 ? l.debit_cents : l.credit_cents,
        })),
      })
      navigate('/journal')
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return <Typography color="error" sx={{ p: 2 }}>{error}</Typography>
  }
  if (!entry) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  // An entry that has been corrected (voided/reversed) or is itself a
  // correction offers no action — just an explanatory banner. Otherwise the
  // booking period decides: open → Void (hide + exclude), closed → Reverse
  // (visible corrections-forward entry).
  const isVoidedOriginal = entry.voided_by_transaction_id != null
  const isReversedOriginal = entry.reversed_by_transaction_id != null
  const isCorrection = entry.corrects_transaction_id != null
  const actionable = !isVoidedOriginal && !isReversedOriginal && !isCorrection
  let correctionNotice: { text: string; linkId?: Id } | null = null
  if (isVoidedOriginal) {
    correctionNotice = { text: t($ => $.detail.notice.voided), linkId: entry.voided_by_transaction_id ?? undefined }
  } else if (isReversedOriginal) {
    correctionNotice = { text: t($ => $.detail.notice.reversed), linkId: entry.reversed_by_transaction_id ?? undefined }
  } else if (isCorrection) {
    correctionNotice = {
      text: entry.voided ? t($ => $.detail.notice.correctionVoid) : t($ => $.detail.notice.correctionReverse),
      linkId: entry.corrects_transaction_id ?? undefined,
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton aria-label={t($ => $.aria.back, { ns: 'common' })} onClick={() => navigate('/ledger')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
          {t($ => $.detail.heading, { name: entry.description || `#${entry.id}` })}
        </Typography>
        <Button variant="outlined" onClick={copyToJournal} disabled={busy}>
          {t($ => $.actions.copy, { ns: 'common' })}
        </Button>
        {actionable && entry.period_open && (
          <Button variant="contained" color="error" onClick={() => setVoidOpen(true)} disabled={busy}>
            {t($ => $.detail.actions.void)}
          </Button>
        )}
        {actionable && !entry.period_open && (
          <Button variant="contained" color="warning" onClick={() => setReverseOpen(true)} disabled={busy}>
            {t($ => $.detail.actions.reverse)}
          </Button>
        )}
      </Box>

      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

      {correctionNotice && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {correctionNotice.text}
          {correctionNotice.linkId != null && (
            <>
              {' '}
              <Link component={RouterLink} to={`/ledger/${correctionNotice.linkId}`}>
                {t($ => $.detail.notice.viewEntry, { id: correctionNotice.linkId })}
              </Link>
            </>
          )}
        </Alert>
      )}

      <Dialog open={voidOpen} onClose={() => setVoidOpen(false)}>
        <DialogTitle>{t($ => $.detail.voidDialog.title)}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t($ => $.detail.voidDialog.body)}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidOpen(false)} disabled={busy}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
          <Button variant="contained" color="error" onClick={confirmVoid} disabled={busy}>
            {t($ => $.detail.voidDialog.confirm)}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={reverseOpen} onClose={() => setReverseOpen(false)}>
        <DialogTitle>{t($ => $.detail.reverseDialog.title)}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t($ => $.detail.reverseDialog.body)}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReverseOpen(false)} disabled={busy}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
          <Button variant="contained" color="warning" onClick={confirmReverse} disabled={busy}>
            {t($ => $.detail.reverseDialog.confirm)}
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <LedgerLinesTable lines={entry.lines ?? []} />
        <Paper variant="outlined" sx={{ p: 2, width: { xs: '100%', sm: 280 }, flexShrink: 0 }}>
          <MetaField label={t($ => $.detail.meta.number)} value={String(entry.id)} />
          {entry.receipt != null && <MetaField label={t($ => $.detail.meta.receipt)} value={String(entry.receipt)} />}
          <MetaField label={t($ => $.detail.meta.date)} value={formatShortDate(entry.entry_date)} />
          <MetaField
            label={t($ => $.detail.meta.created)}
            value={entry.created_at
              ? new Date(entry.created_at).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
              : '-'}
          />
          <MetaField label={t($ => $.detail.meta.createdBy)} value={entry.created_by_name || '-'} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{t($ => $.detail.meta.origin)}</Typography>
          {entry.origin?.path ? (
            <Link component={RouterLink} to={entry.origin.path} variant="body2">
              {entry.origin.label}
            </Link>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {entry.origin?.label || '-'}
            </Typography>
          )}
        </Paper>
      </Box>
    </Box>
  )
}

interface MetaFieldProps {
  label: string
  value: string
}

function MetaField({ label, value }: MetaFieldProps) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{label}</Typography>
      <Typography variant="body2" color="text.secondary">{value}</Typography>
    </Box>
  )
}

// A ledger line uses only one side, so the unused side is blank. Render two
// empty cells (matching MoneyCells' two-column shape) rather than "€ 0,00".
interface MoneyOrBlankCellsProps {
  cents: number | undefined
}

function MoneyOrBlankCells({ cents }: MoneyOrBlankCellsProps) {
  if (!cents) {
    return (
      <>
        <TableCell padding="none" />
        <TableCell />
      </>
    )
  }
  return <MoneyCells cents={cents} />
}

interface LedgerLinesTableProps {
  lines: LedgerLine[]
}

function LedgerLinesTable({ lines }: LedgerLinesTableProps) {
  const { t } = useTranslation('ledger')
  const isCompact = useCompactLayout()
  const totalDebit = lines.reduce((s, l) => s + (l.debit_cents ?? 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (l.credit_cents ?? 0), 0)

  if (isCompact) {
    return (
      <Paper variant="outlined" sx={{ width: '100%' }}>
        {lines.map((line) => (
          <Box
            key={String(line.id)}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1.5,
              p: 1.5,
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {line.account_code}
                </Typography>
                <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {line.account_name || '-'}
                </Typography>
              </Box>
              {line.memo && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                  {line.memo}
                </Typography>
              )}
            </Box>
            <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {formatSigned(line)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {(line.debit_cents ?? 0) > 0 ? t($ => $.detail.lines.debit) : t($ => $.detail.lines.credit)}
              </Typography>
            </Box>
          </Box>
        ))}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', p: 1.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{t($ => $.detail.lines.total)}</Typography>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t($ => $.detail.lines.totalDebit, { amount: formatEur(totalDebit) })}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t($ => $.detail.lines.totalCredit, { amount: formatEur(totalCredit) })}
            </Typography>
          </Box>
        </Box>
      </Paper>
    )
  }

  return (
    <Paper variant="outlined" sx={{ flex: '1 1 480px', minWidth: 0 }}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t($ => $.detail.lines.number)}</TableCell>
              <TableCell>{t($ => $.detail.lines.name)}</TableCell>
              <TableCell>{t($ => $.detail.lines.description)}</TableCell>
              <TableCell align="right">{t($ => $.detail.lines.inEur)}</TableCell>
              <MoneyHeaderCells label={t($ => $.detail.lines.debit)} />
              <MoneyHeaderCells label={t($ => $.detail.lines.credit)} />
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={String(line.id)}>
                <TableCell>{line.account_code}</TableCell>
                <TableCell>{line.account_name || '-'}</TableCell>
                <TableCell>{line.memo || ''}</TableCell>
                <TableCell align="right">{formatSigned(line)}</TableCell>
                <MoneyOrBlankCells cents={line.debit_cents} />
                <MoneyOrBlankCells cents={line.credit_cents} />
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={3} />
              <TableCell align="right">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{t($ => $.detail.lines.totalEur)}</Typography>
              </TableCell>
              <MoneyCells cents={totalDebit} bold />
              <MoneyCells cents={totalCredit} bold />
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}
