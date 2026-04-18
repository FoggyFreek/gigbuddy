import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import MusicNoteIcon from '@mui/icons-material/MusicNote'

export default function LoginPage() {
  const handleSignIn = () => {
    window.location.href = '/api/auth/login'
  }

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 6,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
          maxWidth: 380,
          width: '100%',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MusicNoteIcon color="primary" sx={{ fontSize: 36 }} />
          <Typography variant="h4" fontWeight={700}>
            gigBuddy
          </Typography>
        </Box>
        <Typography variant="body1" color="text.secondary" textAlign="center">
          Band management for working musicians
        </Typography>
        <Button
          variant="contained"
          size="large"
          fullWidth
          onClick={handleSignIn}
          sx={{ mt: 1 }}
        >
          Sign in with Google
        </Button>
      </Paper>
    </Box>
  )
}
