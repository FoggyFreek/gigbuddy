import { useEffect, useState } from 'react'
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
import PropTypes from 'prop-types'
import { getLedgerEntry, voidLedgerEntry, reverseLedgerEntry } from '../api/ledger.js'
import { createJournal } from '../api/journal.js'
import { useCompactLayout } from '../hooks/useCompactLayout.js'
import { formatEur } from '../utils/invoiceTotals.js'
import { formatShortDate } from '../utils/dateFormat.js'
import { ledgerLineShape } from '../propTypes/shared.js'
import MoneyCells, { MoneyHeaderCells } from '../components/shared/MoneyCells.jsx'

const decimalEur = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Signed net per line for the "In EUR" column: debits positive, credits negative.
function formatSigned(line) {
  return decimalEur.format((line.debit_cents - line.credit_cents) / 100)
}

export default function LedgerEntryDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [entry, setEntry] = useState(null)
  const [error, setError] = useState(null)
  const [voidOpen, setVoidOpen] = useState(false)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setEntry(null)
    setActionError(null)
    getLedgerEntry(Number(id))
      .then((data) => { if (!cancelled) setEntry(data) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [id])

  async function confirmVoid() {
    setBusy(true)
    setActionError(null)
    try {
      const { id: voidId } = await voidLedgerEntry(entry.id)
      setVoidOpen(false)
      navigate(`/ledger/${voidId}`)
    } catch (e) {
      setVoidOpen(false)
      setActionError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmReverse() {
    setBusy(true)
    setActionError(null)
    try {
      const { id: reverseId } = await reverseLedgerEntry(entry.id)
      setReverseOpen(false)
      navigate(`/ledger/${reverseId}`)
    } catch (e) {
      setReverseOpen(false)
      setActionError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // Copies the entry's raw lines into a draft journal (gross amounts, no VAT
  // split — the lines already are the final ledger legs).
  async function copyToJournal() {
    setBusy(true)
    setActionError(null)
    try {
      await createJournal({
        description: entry.description || null,
        lines: entry.lines.map((l) => ({
          description: l.memo,
          account_code: l.account_code,
          vat_rate: 0,
          side: l.debit_cents > 0 ? 'debit' : 'credit',
          amount_cents: l.debit_cents > 0 ? l.debit_cents : l.credit_cents,
        })),
      })
      navigate('/journal')
    } catch (e) {
      setActionError(e.message)
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
  let correctionNotice = null
  if (isVoidedOriginal) {
    correctionNotice = { text: 'This ledger entry has been voided by another ledger entry.', linkId: entry.voided_by_transaction_id }
  } else if (isReversedOriginal) {
    correctionNotice = { text: 'This ledger entry has been reversed by another ledger entry.', linkId: entry.reversed_by_transaction_id }
  } else if (isCorrection) {
    correctionNotice = { text: `This ledger entry was created to ${entry.voided ? 'void' : 'reverse'} another ledger entry.`, linkId: entry.corrects_transaction_id }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton aria-label="back" onClick={() => navigate('/ledger')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" fontWeight={600} sx={{ flex: 1, minWidth: 0 }}>
          Ledger entry: {entry.description || `#${entry.id}`}
        </Typography>
        <Button variant="outlined" onClick={copyToJournal} disabled={busy}>
          Copy
        </Button>
        {actionable && entry.period_open && (
          <Button variant="contained" color="error" onClick={() => setVoidOpen(true)} disabled={busy}>
            Void
          </Button>
        )}
        {actionable && !entry.period_open && (
          <Button variant="contained" color="warning" onClick={() => setReverseOpen(true)} disabled={busy}>
            Reverse
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
                View entry #{correctionNotice.linkId}
              </Link>
            </>
          )}
        </Alert>
      )}

      <Dialog open={voidOpen} onClose={() => setVoidOpen(false)}>
        <DialogTitle>Void ledger entry?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Do you want to void this ledger entry? Doing so will create a new ledger entry that
            cancels out this one.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="contained" color="error" onClick={confirmVoid} disabled={busy}>
            Void entry
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={reverseOpen} onClose={() => setReverseOpen(false)}>
        <DialogTitle>Reverse ledger entry?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This entry falls in a closed booking period. Reversing posts a new, visible ledger entry
            in the current open period that cancels it out; the original entry is kept unchanged.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReverseOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={confirmReverse} disabled={busy}>
            Reverse entry
          </Button>
        </DialogActions>
      </Dialog>

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <LedgerLinesTable lines={entry.lines} />
        <Paper variant="outlined" sx={{ p: 2, width: { xs: '100%', sm: 280 }, flexShrink: 0 }}>
          <MetaField label="Ledger entry number" value={String(entry.id)} />
          {entry.receipt != null && <MetaField label="Receipt" value={String(entry.receipt)} />}
          <MetaField label="Date" value={formatShortDate(entry.entry_date)} />
          <MetaField
            label="Created"
            value={entry.created_at
              ? new Date(entry.created_at).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })
              : '-'}
          />
          <MetaField label="Created by" value={entry.created_by_name || '-'} />
          <Typography variant="subtitle2" fontWeight={600}>Origin</Typography>
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

function MetaField({ label, value }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="subtitle2" fontWeight={600}>{label}</Typography>
      <Typography variant="body2" color="text.secondary">{value}</Typography>
    </Box>
  )
}

MetaField.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
}

// A ledger line uses only one side, so the unused side is blank. Render two
// empty cells (matching MoneyCells' two-column shape) rather than "€ 0,00".
function MoneyOrBlankCells({ cents }) {
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

MoneyOrBlankCells.propTypes = {
  cents: PropTypes.number.isRequired,
}

function LedgerLinesTable({ lines }) {
  const isCompact = useCompactLayout()
  const totalDebit = lines.reduce((s, l) => s + l.debit_cents, 0)
  const totalCredit = lines.reduce((s, l) => s + l.credit_cents, 0)

  if (isCompact) {
    return (
      <Paper variant="outlined" sx={{ width: '100%' }}>
        {lines.map((line) => (
          <Box
            key={line.id}
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
                <Typography variant="body2" fontWeight={600}>
                  {line.account_code}
                </Typography>
                <Typography variant="body2" noWrap>
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
              <Typography variant="body2" fontWeight={500}>
                {formatSigned(line)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {line.debit_cents > 0 ? 'Debit' : 'Credit'}
              </Typography>
            </Box>
          </Box>
        ))}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', p: 1.5 }}>
          <Typography variant="body2" fontWeight={600}>Total</Typography>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="body2" fontWeight={600}>
              {formatEur(totalDebit)} debit
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {formatEur(totalCredit)} credit
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
              <TableCell>Number</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="right">In EUR</TableCell>
              <MoneyHeaderCells label="Debit" />
              <MoneyHeaderCells label="Credit" />
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
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
                <Typography variant="body2" fontWeight={600}>Total EUR:</Typography>
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

LedgerLinesTable.propTypes = {
  lines: PropTypes.arrayOf(ledgerLineShape).isRequired,
}
