import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { useCompactLayout } from '../../../../hooks/useCompactLayout.ts'
import { getProfile, setJoinPolicy } from '../../../profiles/profile.ts'
import type { JoinPolicy } from '../../../memberships/membership.ts'

// "Let musicians find us and ask to join." Off by default and off for every
// band that exists today — turning it on is the only way into the directory.
export default function DiscoverabilitySection() {
  const { t } = useTranslation('settings')
  const compact = useCompactLayout()
  const [policy, setPolicy] = useState<JoinPolicy | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getProfile()
      .then((p) => setPolicy((p.join_policy as JoinPolicy) ?? 'invite_only'))
      .catch(() => setError(true))
  }, [])

  async function toggle(findable: boolean) {
    const next: JoinPolicy = findable ? 'request' : 'invite_only'
    setBusy(true)
    setError(false)
    try {
      const updated = await setJoinPolicy(next)
      setPolicy((updated.join_policy as JoinPolicy) ?? next)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {t($ => $.discoverability.title)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 1.5 }}>
        {t($ => $.discoverability.help)}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{t($ => $.members.errors.updateFailed)}</Alert>}

      <FormControlLabel
        control={
          <Switch
            checked={policy === 'request'}
            disabled={policy === null || busy}
            onChange={(e) => { void toggle(e.target.checked) }}
          />
        }
        label={t($ => $.discoverability.toggle)}
      />
    </Paper>
  )
}
