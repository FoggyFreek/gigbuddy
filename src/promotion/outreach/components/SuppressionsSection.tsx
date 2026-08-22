import { useEffect, useState } from 'react'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { usePermissions } from '../../../hooks/usePermissions.ts'
import {
  addOutreachSuppression, listOutreachSuppressions,
  removeOutreachSuppression, type OutreachSuppression,
} from '../outreachCampaigns.ts'

// Addresses that outreach must never mail again. These are marketing opt-outs:
// transactional invoice mail deliberately ignores them, which the copy says out
// loud so nobody expects a suppression to withhold an invoice.
export default function SuppressionsSection() {
  const { t } = useTranslation('outreach')
  const { canWritePlanning } = usePermissions()
  const [suppressions, setSuppressions] = useState<OutreachSuppression[]>([])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listOutreachSuppressions()
      .then((blocked) => { if (!cancelled) setSuppressions(blocked.items) })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => { cancelled = true }
  }, [])

  async function addSuppression() {
    try {
      const created = await addOutreachSuppression(email)
      setSuppressions((rows) => [created, ...rows])
      setEmail('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }

  async function removeSuppression(row: OutreachSuppression) {
    try {
      await removeOutreachSuppression(row.id)
      setSuppressions((rows) => rows.filter((entry) => entry.id !== row.id))
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">{t($ => $.campaigns.suppressionsDescription)}</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {canWritePlanning && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            type="email"
            size="small"
            label={t($ => $.campaigns.email)}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button startIcon={<AddIcon />} disabled={!email} onClick={() => { void addSuppression() }}>
            {t($ => $.campaigns.addSuppression)}
          </Button>
        </Stack>
      )}
      {suppressions.length === 0
        ? <Typography variant="body2" color="text.secondary">{t($ => $.campaigns.noSuppressions)}</Typography>
        : (
          <Stack>
            {suppressions.map((row) => (
              <Box
                key={row.id}
                sx={{ display: 'flex', alignItems: 'center', borderTop: '1px solid', borderColor: 'divider', py: 1 }}
              >
                <Typography sx={{ flexGrow: 1 }}>{row.email} · {row.reason}</Typography>
                {canWritePlanning && (
                  <IconButton
                    aria-label={t($ => $.campaigns.removeSuppression)}
                    onClick={() => { void removeSuppression(row) }}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                )}
              </Box>
            ))}
          </Stack>
        )}
    </Stack>
  )
}
