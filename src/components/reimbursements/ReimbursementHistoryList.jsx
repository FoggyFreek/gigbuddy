import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import PeriodPicker from '../shared/periodPicker.jsx'
import { listReimbursements, listReimbursementPeriods } from '../../api/reimbursements.js'
import { useCompactLayout } from '../../hooks/useCompactLayout.js'
import { formatEur } from '../../utils/purchaseTotals.js'
import { formatShortDate } from '../../utils/dateFormat.js'
import { defaultPeriodForDates } from '../../utils/invoicePeriod.js'

// Past reimbursements, period-filtered. Loads the available dates first (like the
// purchases page) so the period picker can default sensibly, then the list.
export default function ReimbursementHistoryList() {
  const isCompact = useCompactLayout()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState(() => ({ mode: 'fiscal_year', year: new Date().getFullYear() }))
  const [availableDates, setAvailableDates] = useState([])
  const [periodsLoaded, setPeriodsLoaded] = useState(false)

  useEffect(() => {
    listReimbursementPeriods()
      .then((dates) => {
        setAvailableDates(dates)
        setPeriod((prev) => {
          const currentYear = new Date().getFullYear()
          if (prev.mode !== 'fiscal_year' || prev.year !== currentYear) return prev
          return defaultPeriodForDates(dates)
        })
      })
      .catch((e) => setError(e.message))
      .finally(() => setPeriodsLoaded(true))
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setRows(await listReimbursements(period))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    if (periodsLoaded) load()
  }, [load, periodsLoaded])

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
        <PeriodPicker availableDates={availableDates} value={period} onChange={setPeriod} />
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      )}
      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      {!loading && isCompact && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {!rows.length && (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              No reimbursements found
            </Typography>
          )}
          {rows.map((r) => (
            <Paper key={r.id} variant="outlined" sx={{ p: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
                <Typography variant="body1" fontWeight={600}>{r.band_member_name}</Typography>
                <Typography variant="h6" fontWeight={700}>{formatEur(r.amount_cents)}</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {formatShortDate(r.paid_on)} · {r.purchases.map((p) => `#${p.receipt_number}`).join(', ')}
              </Typography>
              {r.memo && <Typography variant="body2" sx={{ mt: 0.5 }}>{r.memo}</Typography>}
            </Paper>
          ))}
        </Box>
      )}

      {!loading && !isCompact && (
        <Paper variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Paid on</TableCell>
                  <TableCell>Member</TableCell>
                  <TableCell>Settled receipts</TableCell>
                  <TableCell>Memo</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        No reimbursements found
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>{formatShortDate(r.paid_on)}</TableCell>
                    <TableCell>{r.band_member_name}</TableCell>
                    <TableCell>{r.purchases.map((p) => `#${p.receipt_number}`).join(', ')}</TableCell>
                    <TableCell>{r.memo || ''}</TableCell>
                    <TableCell align="right">{formatEur(r.amount_cents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  )
}
