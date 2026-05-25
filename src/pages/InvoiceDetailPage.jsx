import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import InvoiceDetails from '../components/InvoiceDetails.jsx'

export default function InvoiceDetailPage() {
  const { id } = useParams()
  const invoiceId = Number(id)
  const navigate = useNavigate()
  const outletCtx = useOutletContext() || {}
  const insideSplitView = !!outletCtx.insideSplitView

  function closeView(reload) {
    if (reload && outletCtx.onReload) outletCtx.onReload()
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate(-1)
  }

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={() => closeView(false)} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" fontWeight={600}>Invoice</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={() => closeView(false)} aria-label="close">
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      <InvoiceDetails
        key={invoiceId}
        mode="edit"
        invoiceId={invoiceId}
        onClose={(reload) => closeView(reload)}
        onInvoiceUpdate={outletCtx.onInvoiceUpdate}
        embedded
      />
    </Box>
  )
}
