import { useCallback, useState } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { TERMS_VERSION } from '../../shared/termsVersion.js'
import { useAuth } from '../contexts/authContext.ts'
import { acceptTerms } from '../api/auth.ts'
import { termsForLanguage } from '../content/terms/index.ts'

// Standalone terms re-acceptance surface. RequireAuth bounces here any user who
// would otherwise get full app access while on an outdated (or never-accepted)
// TERMS_VERSION — invite-approved members and everyone after a version bump.
// The onboarding welcome step handles first-time acceptance for band creators;
// this page is for the pass-through cases that never touch that wizard.
export default function AcceptTermsPage() {
  const { t, i18n } = useTranslation('onboarding')
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshUser } = useAuth()
  const doc = termsForLanguage(i18n.language)

  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Where the user was headed when the gate fired, so acceptance returns them
  // there rather than always dumping them on the dashboard.
  const from = (location.state as { from?: Location } | null)?.from?.pathname ?? '/'

  const handleAccept = useCallback(async () => {
    if (!agreed) return
    setBusy(true)
    setError(null)
    try {
      await acceptTerms(TERMS_VERSION)
      await refreshUser()
      navigate(from, { replace: true })
    } catch {
      setError(t($ => $.errors.generic))
    } finally {
      setBusy(false)
    }
  }, [agreed, refreshUser, navigate, from, t])

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
        px: 2,
        py: 4,
      }}
    >
      <Paper
        elevation={3}
        sx={{ p: 4, maxWidth: 760, width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        <Stack spacing={1}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {t($ => $.acceptTerms.title)}
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            {t($ => $.acceptTerms.subtitle)}
          </Typography>
        </Stack>

        <Box sx={{ maxHeight: 360, overflowY: 'auto', borderRadius: 2, border: 1, borderColor: 'divider', p: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
            {doc.title}
          </Typography>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {doc.draftNotice}
          </Alert>
          {doc.intro.map((paragraph) => (
            <Typography key={paragraph} variant="body2" sx={{ mb: 1.5 }}>
              {paragraph}
            </Typography>
          ))}
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 2, mb: 1 }}>
                {section.heading}
              </Typography>
              {section.paragraphs.map((paragraph) => (
                <Typography key={paragraph} variant="body2" sx={{ mb: 1.5 }}>
                  {paragraph}
                </Typography>
              ))}
            </section>
          ))}
        </Box>

        <FormControlLabel
          control={<Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />}
          label={t($ => $.acceptTerms.agree)}
        />

        {error && <Alert severity="error">{error}</Alert>}

        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button variant="contained" disabled={busy || !agreed} onClick={() => void handleAccept()}>
            {t($ => $.acceptTerms.accept)}
          </Button>
        </Stack>
      </Paper>
    </Box>
  )
}
