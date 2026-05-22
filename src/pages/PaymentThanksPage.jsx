import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'

export default function PaymentThanksPage() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Paper
        variant="outlined"
        sx={{ p: 5, maxWidth: 420, width: '100%', textAlign: 'center' }}
      >
        <CheckCircleOutlineIcon
          sx={{ fontSize: 64, color: 'success.main', mb: 2 }}
        />
        <Typography variant="h5" fontWeight={600} gutterBottom>
          Thanks for your payment
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
          We&apos;ll process the payment confirmation shortly.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          You may close this page.
        </Typography>
      </Paper>
    </Box>
  )
}
