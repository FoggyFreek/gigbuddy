import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { ThemeProvider } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { createAppTheme } from '../theme'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { GoogleIcon, MicrosoftIcon } from '../components/shared/ProviderIcons.tsx'

const PROVIDER_BUTTON_SX = {
  height: 44,
  bgcolor: '#FFFFFF',
  color: '#3c4043',
  border: '1px solid #dadce0',
  fontFamily: 'Roboto, sans-serif',
  fontWeight: 500,
  fontSize: '14px',
  letterSpacing: '0.25px',
  textTransform: 'none',
  borderRadius: '4px',
  '&:hover': {
    bgcolor: '#f8f9fa',
    border: '1px solid #dadce0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
  '&:active': {
    bgcolor: '#f1f3f4',
  },
} as const

export default function LoginPage() {
  const { t } = useTranslation('auth')
  const [searchParams] = useSearchParams()
  // Set by the OIDC callback when a sign-in's email collides with an existing
  // account: auto-linking is forbidden, so the user gets guidance instead.
  const authError = searchParams.get('authError')
  // The login page is always presented in the light 'default' variant, regardless
  // of the user's saved theme — its branding (logo, lavender background) is designed
  // for it. Locked here so a returning user's dark/warm/slate choice can't apply.
  const lightTheme = useMemo(() => createAppTheme('light', null, 'default'), [])
  const handleSignIn = () => {
    window.location.href = '/api/auth/login'
  }
  const handleMicrosoftSignIn = () => {
    window.location.href = '/api/auth/login/microsoft'
  }

  return (
    <ThemeProvider theme={lightTheme}>
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: '#F4F1FB',
        px: 2,
      }}
    >
      <Box sx={{ position: 'absolute', top: 16, right: 16 }}>
        <LanguageSwitcher />
      </Box>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 4, sm: 6 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          maxWidth: 400,
          width: '100%',
          border: '1px solid',
          borderColor: 'rgba(0,0,0,0.08)',
          borderRadius: 3,
          bgcolor: '#FFFFFF',
        }}
      >
        <Box
          component="img"
          src="/icons/gigbuddy_logo1.png"
          alt="gigbuddy"
          sx={{
            width: 180,
            height: 'auto',
            mixBlendMode: 'multiply',
            mb: 1,
          }}
        />

        <Typography
          variant="body1"
          sx={{ color: 'text.secondary', textAlign: 'center', lineHeight: 1.6 }}
        >
          {t($ => $.tagline)}
        </Typography>

        <Divider sx={{ width: '100%', my: 1 }} />

        {authError === 'account_exists' && (
          <Alert severity="warning" sx={{ width: '100%' }}>
            {t($ => $.accountExists)}
          </Alert>
        )}

        <Button
          fullWidth
          onClick={handleSignIn}
          startIcon={<GoogleIcon />}
          sx={PROVIDER_BUTTON_SX}
        >
          {t($ => $.signInWithGoogle)}
        </Button>

        <Button
          fullWidth
          onClick={handleMicrosoftSignIn}
          startIcon={<MicrosoftIcon />}
          sx={PROVIDER_BUTTON_SX}
        >
          {t($ => $.signInWithMicrosoft)}
        </Button>

        <Typography variant="caption" sx={{ color: 'text.disabled', textAlign: 'center', mt: 0.5 }}>
          {t($ => $.inviteOnly)}
        </Typography>
      </Paper>

      <Typography variant="caption" sx={{ color: 'text.disabled', mt: 4 }}>
        © {new Date().getFullYear()} gigbuddy
      </Typography>
    </Box>
    </ThemeProvider>
  )
}
