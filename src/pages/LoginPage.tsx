import { useMemo } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { ThemeProvider } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { createAppTheme } from '../theme'
import LanguageSwitcher from '../components/LanguageSwitcher'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

export default function LoginPage() {
  const { t } = useTranslation('auth')
  // The login page is always presented in the light 'default' variant, regardless
  // of the user's saved theme — its branding (logo, lavender background) is designed
  // for it. Locked here so a returning user's dark/warm/slate choice can't apply.
  const lightTheme = useMemo(() => createAppTheme('light', null, 'default'), [])
  const handleSignIn = () => {
    window.location.href = '/api/auth/login'
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

        <Button
          fullWidth
          onClick={handleSignIn}
          startIcon={<GoogleIcon />}
          sx={{
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
          }}
        >
          {t($ => $.signInWithGoogle)}
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
