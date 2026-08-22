import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
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
import { listWebhookFailureAlerts } from './adminOperations.ts'
import type { WebhookFailureAlert } from './adminOperations.ts'
import { formatAdminTimestamp, userLabel } from './operationFormat.ts'

export default function WebhookFailuresPage() {
  const { t, i18n } = useTranslation('adminOperations')
  const isCompact = useCompactLayout()
  const [items, setItems] = useState<WebhookFailureAlert[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    listWebhookFailureAlerts().then((result) => { if (!cancelled) setItems(result.items) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  return (
    <Box>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 1 }}>{t($ => $.webhooks.title)}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>{t($ => $.webhooks.intro)}</Typography>
      {error && <Alert severity="error">{t($ => $.common.loadError)}</Alert>}
      {!error && items === null && <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>}
      {items?.length === 0 && <Alert severity="success">{t($ => $.webhooks.empty)}</Alert>}
      {items && items.length > 0 && (isCompact ? (
        <Stack spacing={1.5}>{items.map((item) => (
          <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 600 }}>{item.providerPaymentId}</Typography>
            <Typography variant="body2">{userLabel(item.userName, item.userEmail, t($ => $.common.unknownUser))}</Typography>
            <Typography variant="caption" sx={{ color: 'error.main', display: 'block' }}>{item.errorCode ?? t($ => $.common.notAvailable)}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{formatAdminTimestamp(item.receivedAt, i18n.resolvedLanguage, t($ => $.common.notAvailable))}</Typography>
          </Paper>
        ))}</Stack>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}><Table size="small" aria-label={t($ => $.webhooks.title)}>
          <TableHead><TableRow>
            <TableCell>{t($ => $.webhooks.payment)}</TableCell><TableCell>{t($ => $.webhooks.subscription)}</TableCell>
            <TableCell>{t($ => $.webhooks.user)}</TableCell><TableCell>{t($ => $.webhooks.received)}</TableCell>
            <TableCell>{t($ => $.webhooks.error)}</TableCell>
          </TableRow></TableHead>
          <TableBody>{items.map((item) => <TableRow key={item.id}>
            <TableCell>{item.providerPaymentId}</TableCell><TableCell>{item.subscriptionId ?? t($ => $.common.notAvailable)}</TableCell>
            <TableCell>{userLabel(item.userName, item.userEmail, t($ => $.common.unknownUser))}</TableCell>
            <TableCell>{formatAdminTimestamp(item.receivedAt, i18n.resolvedLanguage, t($ => $.common.notAvailable))}</TableCell>
            <TableCell>{item.errorCode ?? t($ => $.common.notAvailable)}</TableCell>
          </TableRow>)}</TableBody>
        </Table></Paper>
      ))}
    </Box>
  )
}
