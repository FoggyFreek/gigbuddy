import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'
import {
  getAvailabilitySettings,
  updateAvailabilitySettings,
  type AvailabilitySettings,
  type AvailabilitySettingsPatch,
} from '../../../../user/availability/userAvailability.ts'
import type { Id } from '../../../../types/entities.ts'

// The musician's own privacy and delegation controls. These live ONLY here:
// no band-side screen can read or change another user's flags, which is why
// this section sits under the user's account settings rather than a band's.
export default function MyAvailabilitySection() {
  const { t } = useTranslation('availability')
  const compact = useCompactLayout()
  const [settings, setSettings] = useState<AvailabilitySettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [marginInput, setMarginInput] = useState('2')

  useEffect(() => {
    getAvailabilitySettings()
      .then((loaded) => {
        setSettings(loaded)
        setMarginInput(String(loaded.travelMarginHours ?? 2))
      })
      .catch(() => setError(t($ => $.mine.loadFailed)))
  }, [t])

  async function save(patch: AvailabilitySettingsPatch) {
    setBusy(true)
    setError(null)
    try {
      setSettings(await updateAvailabilitySettings(patch))
    } catch {
      setError(t($ => $.mine.saveFailed))
    } finally {
      setBusy(false)
    }
  }

  const setDelegation = (tenantId: Id, managedByBand: boolean) =>
    save({ delegations: [{ tenantId, managedByBand }] })

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {t($ => $.mine.title)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 2 }}>
        {t($ => $.mine.help)}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {/* Both default to off — private by default; sharing is opt-in. */}
      <Stack spacing={2}>
        <Stack sx={{ maxWidth: 280 }}>
          <TextField
            type="number"
            label={t($ => $.mine.travelMargin)}
            value={marginInput}
            disabled={settings === null || busy}
            slotProps={{ htmlInput: { min: 0, max: 24, step: 1 } }}
            onChange={(event) => setMarginInput(event.target.value)}
            onBlur={() => {
              const margin = Number(marginInput)
              if (!Number.isInteger(margin) || margin < 0 || margin > 24) {
                setMarginInput(String(settings?.travelMarginHours ?? 2))
                return
              }
              if (margin !== settings?.travelMarginHours) void save({ travel_margin_hours: margin })
            }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {t($ => $.mine.travelMarginHelp)}
          </Typography>
        </Stack>

        <Stack>
          <FormControlLabel
            control={
              <Switch
                checked={settings?.availabilityDetailVisible ?? false}
                disabled={settings === null || busy}
                onChange={(e) => { void save({ availability_detail_visible: e.target.checked }) }}
              />
            }
            label={t($ => $.mine.detailVisible)}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', ml: 6 }}>
            {t($ => $.mine.detailVisibleHelp)}
          </Typography>
        </Stack>

        <Stack>
          <FormControlLabel
            control={
              <Switch
                checked={settings?.crossBandGigDetailVisible ?? false}
                disabled={settings === null || busy}
                onChange={(e) => { void save({ cross_band_gig_detail_visible: e.target.checked }) }}
              />
            }
            label={t($ => $.mine.crossBandVisible)}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', ml: 6 }}>
            {t($ => $.mine.crossBandVisibleHelp)}
          </Typography>
        </Stack>
      </Stack>

      <Divider sx={{ my: 3 }} />

      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        {t($ => $.mine.delegationTitle)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 1.5 }}>
        {t($ => $.mine.delegationHelp)}
      </Typography>

      {settings && settings.delegations.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t($ => $.mine.delegationNone)}
        </Typography>
      ) : (
        <Stack>
          {(settings?.delegations ?? []).map((d) => (
            <FormControlLabel
              key={String(d.tenantId)}
              control={
                <Switch
                  checked={d.managedByBand}
                  disabled={busy}
                  onChange={(e) => { void setDelegation(d.tenantId, e.target.checked) }}
                />
              }
              label={t($ => $.mine.delegationLabel, { band: d.displayName })}
            />
          ))}
        </Stack>
      )}
    </Paper>
  )
}
