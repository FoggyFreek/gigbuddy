import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
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
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { listStatusDriftAlerts } from './adminOperations.ts'
import type { StatusDriftAlert } from './adminOperations.ts'
import { formatAdminTimestamp, userLabel } from './operationFormat.ts'

function SignalChips({ item }: Readonly<{ item: StatusDriftAlert }>) {
  const { t } = useTranslation('adminOperations')
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      {item.repairNeeded && <Chip size="small" color="error" label={t($ => $.drift.repairNeeded)} />}
      {item.scheduleStale && <Chip size="small" color="warning" label={t($ => $.drift.scheduleStale)} />}
      {item.stalePayment && <Chip size="small" color="warning" label={t($ => $.drift.stalePayment)} />}
    </Stack>
  )
}

export default function StatusDriftPage() {
  const { t, i18n } = useTranslation('adminOperations')
  const isCompact = useCompactLayout()
  const [items, setItems] = useState<StatusDriftAlert[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    listStatusDriftAlerts().then((result) => { if (!cancelled) setItems(result.items) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  return (
    <Box>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 1 }}>{t($ => $.drift.title)}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>{t($ => $.drift.intro)}</Typography>
      {error && <Alert severity="error">{t($ => $.common.loadError)}</Alert>}
      {!error && items === null && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}
      {items?.length === 0 && <Alert severity="success">{t($ => $.drift.empty)}</Alert>}
      {items && items.length > 0 && (isCompact ? (
        <Stack spacing={1.5}>{items.map((item) => (
          <Paper key={item.subscriptionId} variant="outlined" sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 600 }}>#{item.subscriptionId} · {item.subscriptionStatus}</Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>{userLabel(item.userName, item.userEmail, t($ => $.common.unknownUser))}</Typography>
            <SignalChips item={item} />
          </Paper>
        ))}</Stack>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}><Table size="small" aria-label={t($ => $.drift.title)}>
          <TableHead><TableRow>
            <TableCell>{t($ => $.drift.subscription)}</TableCell><TableCell>{t($ => $.drift.user)}</TableCell>
            <TableCell>{t($ => $.drift.subscriptionStatus)}</TableCell><TableCell>{t($ => $.drift.payment)}</TableCell>
            <TableCell>{t($ => $.drift.updated)}</TableCell><TableCell>{t($ => $.drift.signals)}</TableCell>
          </TableRow></TableHead>
          <TableBody>{items.map((item) => <TableRow key={item.subscriptionId}>
            <TableCell>{item.subscriptionId}</TableCell>
            <TableCell>{userLabel(item.userName, item.userEmail, t($ => $.common.unknownUser))}</TableCell>
            <TableCell>{item.subscriptionStatus}</TableCell>
            <TableCell>{item.paymentId ? `${item.paymentId} · ${item.paymentStatus}` : t($ => $.common.notAvailable)}</TableCell>
            <TableCell>{formatAdminTimestamp(item.paymentUpdatedAt, i18n.resolvedLanguage, t($ => $.common.notAvailable))}</TableCell>
            <TableCell><SignalChips item={item} /></TableCell>
          </TableRow>)}</TableBody>
        </Table></Paper>
      ))}
    </Box>
  )
}
