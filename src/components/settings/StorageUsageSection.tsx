import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DiamondOutlined from '@mui/icons-material/DiamondOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useEntitlements } from '../../hooks/useEntitlements.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { getMyStorageStats, refreshMyStorageStats } from '../../api/statistics.ts'
import { formatBytes } from '../../utils/formatBytes.ts'

interface StorageStats {
  storage_bytes?: number
  object_count?: number
}

export default function StorageUsageSection() {
  const { t } = useTranslation('settings')
  const { limit } = useEntitlements()
  const navigate = useNavigate()
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const compact = useCompactLayout()

  // null = unlimited (or unenforced tenant): show plain usage, no bar/upsell.
  const storageLimitMb = limit('storage_mb')
  const limitBytes = storageLimitMb === null ? null : storageLimitMb * 1024 * 1024
  const usedBytes = stats?.storage_bytes ?? 0
  let usedPct = 0
  if (limitBytes !== null) {
    usedPct = limitBytes > 0 ? Math.min(100, (usedBytes / limitBytes) * 100) : 100
  }
  let barColor: 'primary' | 'warning' | 'error' = 'primary'
  if (usedPct >= 100) barColor = 'error'
  else if (usedPct >= 90) barColor = 'warning'

  useEffect(() => {
    getMyStorageStats().then((s) => setStats(s as unknown as StorageStats)).catch(() => {})
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      setStats(await refreshMyStorageStats() as unknown as StorageStats)
    } catch {
      // best-effort; leave the previous value in place
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600,  flexGrow: 1  }}>
          {t($ => $.storage.title)}
        </Typography>
        <Tooltip title={t($ => $.storage.recompute)}>
          <span>
            <IconButton
              size="small"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label={t($ => $.storage.recomputeAria)}
            >
              {refreshing ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t($ => $.storage.description)}
      </Typography>
      {stats === null ? (
        <CircularProgress size={18} />
      ) : (
        <>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {limitBytes === null
              ? formatBytes(usedBytes)
              : t($ => $.storage.limitUsage, { used: formatBytes(usedBytes), limit: formatBytes(limitBytes) })}
            <Typography component="span" variant="body2" color="text.secondary">
              {' · '}{t($ => $.storage.fileCount, { count: stats.object_count ?? 0 })}
            </Typography>
          </Typography>
          {limitBytes !== null && (
            <>
              <LinearProgress
                variant="determinate"
                value={usedPct}
                color={barColor}
                aria-label={t($ => $.storage.usageAria)}
                sx={{ mt: 1.5, height: 8, borderRadius: 4 }}
              />
              <Button
                size="small"
                variant="outlined"
                color="secondary"
                startIcon={<DiamondOutlined />}
                onClick={() => navigate('/settings/billing')}
                sx={{ mt: 2 }}
              >
                {t($ => $.storage.upgrade)}
              </Button>
            </>
          )}
        </>
      )}
    </Paper>
  )
}
