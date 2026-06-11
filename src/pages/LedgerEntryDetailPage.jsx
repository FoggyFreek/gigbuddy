import { useEffect, useState } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
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
import { getLedgerEntry } from '../api/ledger.js'
import { useCompactLayout } from '../hooks/useCompactLayout.js'
import { formatEur } from '../utils/invoiceTotals.js'
import { formatShortDate } from '../utils/dateFormat.js'
import { ledgerLineShape } from '../propTypes/shared.js'

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

  useEffect(() => {
    let cancelled = false
    getLedgerEntry(Number(id))
      .then((data) => { if (!cancelled) setEntry(data) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [id])

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

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton aria-label="back" onClick={() => navigate('/ledger')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" fontWeight={600}>
          Ledger entry: {entry.description || `#${entry.id}`}
        </Typography>
      </Box>

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
              <TableCell align="right">Debit</TableCell>
              <TableCell align="right">Credit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>{line.account_code}</TableCell>
                <TableCell>{line.account_name || '-'}</TableCell>
                <TableCell>{line.memo || ''}</TableCell>
                <TableCell align="right">{formatSigned(line)}</TableCell>
                <TableCell align="right">{line.debit_cents > 0 ? formatEur(line.debit_cents) : ''}</TableCell>
                <TableCell align="right">{line.credit_cents > 0 ? formatEur(line.credit_cents) : ''}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={3} />
              <TableCell align="right">
                <Typography variant="body2" fontWeight={600}>Total EUR:</Typography>
              </TableCell>
              <TableCell align="right">
                <Typography variant="body2" fontWeight={600}>{formatEur(totalDebit)}</Typography>
              </TableCell>
              <TableCell align="right">
                <Typography variant="body2" fontWeight={600}>{formatEur(totalCredit)}</Typography>
              </TableCell>
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
