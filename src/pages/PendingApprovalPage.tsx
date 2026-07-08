import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { useAuth } from '../contexts/authContext.ts'

const currentYear = new Date().getFullYear()

export default function PendingApprovalPage() {
  const { user, logout } = useAuth()
  const isRejected = user?.status === 'rejected'

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
        px: 2,
      }}
    >
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
          borderColor: 'divider',
          borderRadius: 3,
          bgcolor: 'background.paper',
        }}
      >
        <Box
          component="img"
          src="/icons/gigbuddy_logo1.png"
          alt="gigbuddy"
          sx={{ width: 180, height: 'auto', mixBlendMode: 'multiply', mb: 1 }}
        />

        <Divider sx={{ width: '100%', my: 1 }} />
        {isRejected ? (
          <>
            <Typography variant="h6" sx={{ textAlign: 'center' }}>
              Access denied
            </Typography>
            <Typography
              variant="body1"
              sx={{ color: 'text.secondary', textAlign: 'center', lineHeight: 1.6 }}
            >
              Your access request was not approved. Please contact the band admin if you think this
              is a mistake.
            </Typography>
          </>
        ) : (
          <>
            <Typography variant="h6" sx={{ textAlign: 'center' }}>
              Access request received
            </Typography>
            <Typography
              variant="body1"
              sx={{ color: 'text.secondary', textAlign: 'center', lineHeight: 1.6 }}
            >
              An admin must approve your account before you can continue. Check back soon.
            </Typography>
          </>
        )}
        <Button
          fullWidth
          variant="outlined"
          onClick={logout}
          sx={{ height: 44, textTransform: 'none', borderRadius: '4px' }}
        >
          Log out
        </Button>
      </Paper>

      <Typography variant="caption" sx={{ color: 'text.disabled', mt: 4 }}>
        © {currentYear} gigbuddy
      </Typography>
    </Box>
  )
}
