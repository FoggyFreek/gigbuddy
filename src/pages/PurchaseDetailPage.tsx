import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import PurchaseDetails from '../components/PurchaseDetails.tsx'
import type { Id, Purchase } from '../types/entities.ts'

interface PurchaseDetailOutletContext {
  insideSplitView?: boolean
  onReload?: () => void
  onClose?: () => void
  onPurchaseUpdate?: (id: Id, patch: Partial<Purchase>) => void
}

export default function PurchaseDetailPage() {
  const { id } = useParams()
  const purchaseId = Number(id)
  const navigate = useNavigate()
  const outletCtx = (useOutletContext<PurchaseDetailOutletContext>() || {}) as PurchaseDetailOutletContext
  const insideSplitView = !!outletCtx.insideSplitView

  function closeView(reload?: boolean) {
    if (reload && outletCtx.onReload) outletCtx.onReload()
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate(-1)
  }

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 1200, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={() => closeView(false)} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>Purchase</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={() => closeView(false)} aria-label="close">
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      <PurchaseDetails
        key={purchaseId}
        mode="edit"
        purchaseId={purchaseId}
        onClose={(reload) => closeView(reload)}
        onPurchaseUpdate={outletCtx.onPurchaseUpdate}
        embedded
      />
    </Box>
  )
}
