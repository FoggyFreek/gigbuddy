import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import { useAuth } from '../contexts/authContext.js'

export default function PendingApprovalPage() {
  const { user, logout } = useAuth()
  const isRejected = user?.status === 'rejected'

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
          maxWidth: 420,
          width: '100%',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MusicNoteIcon color="primary" sx={{ fontSize: 36 }} />
          <Typography variant="h4" fontWeight={700}>
            gigBuddy
          </Typography>
        </Box>
        {isRejected ? (
          <>
            <Typography variant="h6" textAlign="center">
              Access denied
            </Typography>
            <Typography variant="body1" color="text.secondary" textAlign="center">
              Your access request was not approved. Please contact the band admin if you think this
              is a mistake.
            </Typography>
          </>
        ) : (
          <>
            <Typography variant="h6" textAlign="center">
              Access request received
            </Typography>
            <Typography variant="body1" color="text.secondary" textAlign="center">
              An admin must approve your account before you can continue. Check back soon.
            </Typography>
          </>
        )}
        <Button variant="outlined" onClick={logout}>
          Log out
        </Button>
      </Paper>
    </Box>
  )
}
