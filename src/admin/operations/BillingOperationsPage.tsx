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
import { listBillingOperationAlerts } from './adminOperations.ts'
import type { BillingOperationAlert } from './adminOperations.ts'
import { formatAdminTimestamp, userLabel } from './operationFormat.ts'

export default function BillingOperationsPage() {
  const { t, i18n } = useTranslation('adminOperations')
  const isCompact = useCompactLayout()
  const [items, setItems] = useState<BillingOperationAlert[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    listBillingOperationAlerts()
      .then((result) => { if (!cancelled) setItems(result.items) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  return (
    <Box>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 1 }}>{t($ => $.billing.title)}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>{t($ => $.billing.intro)}</Typography>
      {error && <Alert severity="error">{t($ => $.common.loadError)}</Alert>}
      {!error && items === null && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}
      {items?.length === 0 && <Alert severity="success">{t($ => $.billing.empty)}</Alert>}
      {items && items.length > 0 && (isCompact ? (
        <Stack spacing={1.5}>
          {items.map((item) => (
            <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
                <Typography sx={{ fontWeight: 600 }}>{item.opType}</Typography>
                <Chip size="small" color={item.status === 'failed_terminal' ? 'error' : 'warning'} label={item.status} />
              </Stack>
              <Typography variant="body2">{userLabel(item.userName, item.userEmail, t($ => $.common.unknownUser))}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                #{item.subscriptionId ?? t($ => $.common.notAvailable)} · {t($ => $.billing.attempts)}: {item.attemptCount}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {formatAdminTimestamp(item.updatedAt, i18n.resolvedLanguage, t($ => $.common.notAvailable))}
              </Typography>
            </Paper>
          ))}
        </Stack>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={t($ => $.billing.title)}>
            <TableHead><TableRow>
              <TableCell>{t($ => $.billing.operation)}</TableCell>
              <TableCell>{t($ => $.billing.status)}</TableCell>
              <TableCell align="right">{t($ => $.billing.attempts)}</TableCell>
              <TableCell>{t($ => $.billing.user)}</TableCell>
              <TableCell>{t($ => $.billing.subscription)}</TableCell>
              <TableCell>{t($ => $.billing.updated)}</TableCell>
              <TableCell>{t($ => $.billing.error)}</TableCell>
            </TableRow></TableHead>
            <TableBody>{items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.opType}</TableCell>
                <TableCell><Chip size="small" color={item.status === 'failed_terminal' ? 'error' : 'warning'} label={item.status} /></TableCell>
                <TableCell align="right">{item.attemptCount}</TableCell>
                <TableCell>{userLabel(item.userName, item.userEmail, t($ => $.common.unknownUser))}</TableCell>
                <TableCell>{item.subscriptionId ?? t($ => $.common.notAvailable)}</TableCell>
                <TableCell>{formatAdminTimestamp(item.updatedAt, i18n.resolvedLanguage, t($ => $.common.notAvailable))}</TableCell>
                <TableCell>{item.lastErrorCode ?? t($ => $.common.notAvailable)}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </Paper>
      ))}
    </Box>
  )
}
