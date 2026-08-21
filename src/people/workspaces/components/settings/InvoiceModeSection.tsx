import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useAuth } from '../../../../contexts/authContext.ts'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'
import { usePermissions } from '../../../../hooks/usePermissions.ts'
import {
  getTenantInvoiceMode,
  updateTenantInvoiceMode,
  type InvoiceMode,
} from '../../tenants.ts'

interface LoadedMode {
  tenantId: number | string | null
  mode: InvoiceMode
}

export default function InvoiceModeSection() {
  const { t } = useTranslation('settings')
  const compact = useCompactLayout()
  const { user } = useAuth()
  const { canManageFinance } = usePermissions()
  const activeTenantId = user?.activeTenantId ?? null
  const [loaded, setLoaded] = useState<LoadedMode | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const current = loaded?.tenantId === activeTenantId ? loaded : null

  useEffect(() => {
    let cancelled = false
    getTenantInvoiceMode()
      .then(({ preferred_invoice_mode }) => {
        if (!cancelled) setLoaded({ tenantId: activeTenantId, mode: preferred_invoice_mode })
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => { cancelled = true }
  }, [activeTenantId])

  async function handleChange(mode: InvoiceMode) {
    if (!canManageFinance || saving) return
    setSaving(true)
    setError(false)
    try {
      const saved = await updateTenantInvoiceMode(mode)
      setLoaded({ tenantId: activeTenantId, mode: saved.preferred_invoice_mode })
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.invoiceMode.title)}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t($ => $.invoiceMode.description)}
      </Typography>

      {!current && !error && <CircularProgress size={24} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{t($ => $.invoiceMode.error)}</Alert>}
      {current && (
        <FormControl disabled={!canManageFinance || saving}>
          <RadioGroup
            value={current.mode}
            onChange={(event) => { void handleChange(event.target.value as InvoiceMode) }}
          >
            <FormControlLabel
              value="combined"
              control={<Radio />}
              label={(
                <Box>
                  <Typography variant="body1">{t($ => $.invoiceMode.options.combined.label)}</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t($ => $.invoiceMode.options.combined.description)}
                  </Typography>
                </Box>
              )}
            />
            <FormControlLabel
              value="specified"
              control={<Radio />}
              label={(
                <Box>
                  <Typography variant="body1">{t($ => $.invoiceMode.options.specified.label)}</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t($ => $.invoiceMode.options.specified.description)}
                  </Typography>
                </Box>
              )}
            />
          </RadioGroup>
        </FormControl>
      )}

      <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
        <Typography variant="subtitle2">{t($ => $.invoiceMode.example.title)}</Typography>
        <Typography variant="body2">{t($ => $.invoiceMode.example.combined)}</Typography>
        <Typography variant="body2">{t($ => $.invoiceMode.example.specified)}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {t($ => $.invoiceMode.example.total)}
        </Typography>
      </Box>
    </Paper>
  )
}
