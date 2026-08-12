import { useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import InvoiceDetails from '../components/InvoiceDetails.tsx'
import { usePermissions } from '../hooks/usePermissions.ts'
import type { Id, Invoice } from '../types/entities.ts'

export default function InvoiceDetailPage() {
  const { t } = useTranslation(['invoices', 'common'])
  // The route only requires finance.view; every invoice mutation (save, delete,
  // status change, logo, payment link, PDF re-generate) is finance.manage on the
  // server, so a viewer without it gets a read-only invoice.
  const { canManageFinance } = usePermissions()
  const { id } = useParams()
  const invoiceId = Number(id)
  const navigate = useNavigate()
  const outletCtx = (useOutletContext() || {}) as Record<string, unknown>
  const insideSplitView = !!outletCtx.insideSplitView
  const [invoiceTitle, setInvoiceTitle] = useState(t($ => $.singularTitle))

  function closeView(reload: boolean) {
    if (reload && typeof outletCtx.onReload === 'function') outletCtx.onReload()
    if (typeof outletCtx.onClose === 'function') outletCtx.onClose()
    else navigate(-1)
  }

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={() => closeView(false)} aria-label={t($ => $.common.actions.back)}>
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" sx={{ fontWeight: 600 }}>{invoiceTitle}</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={() => closeView(false)} aria-label={t($ => $.common.actions.close)}>
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      <InvoiceDetails
        key={invoiceId}
        invoiceId={invoiceId}
        canWrite={canManageFinance}
        onClose={(reload) => closeView(reload ?? false)}
        onInvoiceUpdate={outletCtx.onInvoiceUpdate as ((id: Id, patch: Partial<Invoice>) => void) | undefined}
        onTitleReady={setInvoiceTitle}
      />
    </Box>
  )
}
