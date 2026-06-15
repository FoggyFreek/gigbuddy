import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import MerchandiseDetails from '../components/merch/MerchandiseDetails.tsx'
import type { Period } from '../types/entities.ts'

interface MerchDetailOutletContext {
  insideSplitView?: boolean
  onReload?: () => void
  onClose?: () => void
  period?: Period | null
}

export default function MerchandiseDetailsPage() {
  const { id } = useParams()
  const productId = Number(id)
  const navigate = useNavigate()
  const outletCtx = (useOutletContext<MerchDetailOutletContext>() || {}) as MerchDetailOutletContext
  const insideSplitView = !!outletCtx.insideSplitView

  function closeView() {
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate(-1)
  }

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 1200, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={closeView} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Product sales</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={closeView} aria-label="close">
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      <MerchandiseDetails
        key={productId}
        productId={productId}
        period={outletCtx.period}
        onReload={outletCtx.onReload}
      />
    </Box>
  )
}
