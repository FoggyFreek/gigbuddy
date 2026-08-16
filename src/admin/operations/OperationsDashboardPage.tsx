import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { getOperationsSummary } from './adminOperations.ts'
import type { OperationsSummary } from './adminOperations.ts'

interface AlertCardProps {
  title: string
  value: string | number
  help: string
  to: string
  severity: 'error' | 'warning' | 'info'
}

function AlertCard({ title, value, help, to, severity }: Readonly<AlertCardProps>) {
  const color = severity === 'error' ? 'error.main' : severity === 'warning' ? 'warning.main' : 'info.main'
  return (
    <Card variant="outlined">
      <CardActionArea component={Link} to={to} sx={{ height: '100%' }}>
        <CardContent>
          <Typography variant="overline" sx={{ color }}>{title}</Typography>
          <Typography variant="h4" sx={{ fontWeight: 700, my: 0.5 }}>{value}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>{help}</Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

export default function OperationsDashboardPage() {
  const { t, i18n } = useTranslation('adminOperations')
  const [summary, setSummary] = useState<OperationsSummary | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    getOperationsSummary()
      .then((result) => { if (!cancelled) setSummary(result) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  const oldest = summary?.oldestPendingAt
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' })
        .format(new Date(summary.oldestPendingAt))
    : t($ => $.dashboard.none)

  return (
    <Box>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
        {t($ => $.dashboard.title)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
        {t($ => $.dashboard.intro)}
      </Typography>
      {error && <Alert severity="error">{t($ => $.dashboard.loadError)}</Alert>}
      {!error && !summary && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      )}
      {summary && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 2 }}>
          <AlertCard title={t($ => $.dashboard.terminal)} value={summary.terminalOperations} help={t($ => $.dashboard.terminalHelp)} to="/admin/operations/billing" severity="error" />
          <AlertCard title={t($ => $.dashboard.retrying)} value={summary.retryingOperations} help={t($ => $.dashboard.retryingHelp)} to="/admin/operations/billing" severity="warning" />
          <AlertCard title={t($ => $.dashboard.pending)} value={summary.pendingOperations} help={t($ => $.dashboard.pendingHelp)} to="/admin/operations/billing" severity="info" />
          <AlertCard title={t($ => $.dashboard.oldest)} value={oldest} help={t($ => $.dashboard.oldestHelp)} to="/admin/operations/billing" severity="info" />
          <AlertCard title={t($ => $.dashboard.webhooks)} value={summary.unresolvedWebhookFailures} help={t($ => $.dashboard.webhooksHelp)} to="/admin/operations/webhooks" severity="error" />
          <AlertCard title={t($ => $.dashboard.drift)} value={summary.statusDrift} help={t($ => $.dashboard.driftHelp)} to="/admin/operations/status" severity="warning" />
        </Box>
      )}
    </Box>
  )
}
