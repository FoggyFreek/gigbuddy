import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'

export default function PaymentThanksPage() {
  const [params] = useSearchParams()
  const bandName = params.get('band')?.trim() || ''
  const invoiceId = params.get('invoice')

  const logoSrc = useMemo(() => {
    if (!invoiceId || !/^\d+$/.test(invoiceId)) return null
    return `/api/public/invoices/${invoiceId}/logo`
  }, [invoiceId])

  const heading = bandName
    ? `Bedankt namens ${bandName} voor uw betaling`
    : 'Bedankt voor uw betaling'

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
        {logoSrc && (
          <Box
            component="img"
            src={logoSrc}
            alt={bandName ? `${bandName} logo` : 'Band logo'}
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none' }}
            sx={{ maxWidth: 160, maxHeight: 120, mb: 3, mx: 'auto', display: 'block' }}
          />
        )}
        <CheckCircleOutlineIcon
          sx={{ fontSize: 64, color: 'success.main', mb: 2 }}
        />
        <Typography variant="h5" sx={{ fontWeight: 600 }} gutterBottom>
          {heading}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
          We verwerken de betalingsbevestiging zo spoedig mogelijk.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          U kunt deze pagina sluiten.
        </Typography>
      </Paper>
    </Box>
  )
}
