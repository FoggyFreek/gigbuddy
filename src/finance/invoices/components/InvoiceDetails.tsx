import { useEffect } from 'react'
import type { Id, Invoice, InvoiceStatus } from '../../../types/entities.ts'
import { useTranslation } from 'react-i18next'
import { useCompactLayout } from '../../../hooks/useCompactLayout.ts'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import Tooltip from '@mui/material/Tooltip'
import DownloadIcon from '@mui/icons-material/Download'
import EmailIcon from '@mui/icons-material/Email'
import DeleteIcon from '@mui/icons-material/Delete'
import RefreshIcon from '@mui/icons-material/Refresh'
import CodeIcon from '@mui/icons-material/Code'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import { invoiceStatusColor } from '../invoiceStatus.ts'
import { useInvoiceDetailsState } from './useInvoiceDetailsState.ts'
import InvoiceLogoHeader from './InvoiceLogoHeader.tsx'
import InvoiceCustomerFields from './InvoiceCustomerFields.tsx'
import InvoiceLinesEditor from './InvoiceLinesEditor.tsx'
import InvoiceTotalsPanel from './InvoiceTotalsPanel.tsx'
import InvoicePaidDialog from './InvoicePaidDialog.tsx'
import InvoiceSentDialog from './InvoiceSentDialog.tsx'
import InvoiceVoidDialog from './InvoiceVoidDialog.tsx'
import InvoiceStatusActions from './InvoiceStatusActions.tsx'
import InvoiceEmailDialog from './InvoiceEmailDialog.tsx'
import PaymentLinkPanel from './PaymentLinkPanel.tsx'
import InvoiceDocumentActions from './InvoiceDocumentActions.tsx'
import { useProfile } from '../../../contexts/profileContext.ts'

interface InvoiceDetailsProps {
  invoiceId: Id
  onClose: (updated?: boolean) => void
  onInvoiceUpdate?: (id: Id, patch: Partial<Invoice>) => void
  onTitleReady?: (title: string) => void
  /** false ⇒ read-only view for a viewer without finance.manage. */
  canWrite?: boolean
}

export default function InvoiceDetails({ invoiceId, onClose, onInvoiceUpdate, onTitleReady, canWrite = true }: Readonly<InvoiceDetailsProps>) {
  const { t } = useTranslation(['invoices', 'common'])
  const isCompact = useCompactLayout()
  const s = useInvoiceDetailsState({ invoiceId, onClose, onInvoiceUpdate, canWrite })
  const { isIntegrationConfigured } = useProfile()
  const mollieConfigured = isIntegrationConfigured('mollie')

  useEffect(() => {
    if (s.invoice?.invoice_number != null) {
      onTitleReady?.(t($ => $.detail.heading, { number: s.invoice!.invoice_number }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.invoice?.invoice_number])

  if (s.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  const logoKey = s.invoice?.custom_logo_path
    || (s.form.invert_logo && s.tenant?.logo_dark_path ? s.tenant.logo_dark_path : s.tenant?.logo_path)
    || undefined
  const bandHeading = s.tenant?.formal_name || s.tenant?.band_name || ''

  // Every DOWNLOAD is a read, so it stays available to every finance viewer,
  // while emailing and re-generating the PDF are finance.manage mutations.
  // Re-generating never touches the invoice *data*, so it stays available on a
  // finalized invoice — a rendering fix lands without voiding and re-issuing.
  //
  // InvoiceDocumentActions decides how they are presented: a labelled button
  // each on a wide screen, one overflow menu on a compact one.
  const documentActions = s.invoice ? (
    <InvoiceDocumentActions
      pdfPath={s.invoice.pdf_path}
      onDownloadUbl={s.handleUblDownload}
      onDownloadUblWithPdf={s.handleUblWithPdfDownload}
      ublBusy={s.ublBusy}
      peppolBlockers={s.peppolWarnings.filter((w) => w.severity === 'blocking')}
      canWrite={canWrite}
      onOpenEmailDialog={() => { void s.openEmailDialog() }}
      onRerenderPdf={s.handlePdfRerender}
      pdfRerenderBusy={s.pdfRerenderBusy}
      canDelete={canWrite && !s.finalized}
      onDelete={() => { void s.handleDelete() }}
      canSave={!s.readOnly}
      onSave={s.handleSave}
      saving={s.saving}
    />
  ) : null

  const dialogs = (
    <>
      <InvoiceSentDialog
        open={s.sentDialogOpen}
        invoiceNumber={s.invoice?.invoice_number}
        onCancel={() => s.setSentDialogOpen(false)}
        onConfirm={s.confirmSent}
        blockedReason={s.issueBlocker?.message ?? null}
      />
      <InvoicePaidDialog
        open={s.paidDialogOpen}
        invoiceNumber={s.invoice?.invoice_number}
        onCancel={() => s.setPaidDialogOpen(false)}
        onConfirm={s.confirmPaid}
        blockedReason={s.issueBlocker?.message ?? null}
      />
      <InvoiceVoidDialog
        open={s.voidDialogOpen}
        invoiceNumber={s.invoice?.invoice_number}
        hasPaymentLink={Boolean(s.invoice?.mollie_payment_link_id)}
        wasSent={s.invoice?.status === 'sent'}
        onCancel={() => s.setVoidDialogOpen(false)}
        onConfirm={s.confirmVoid}
      />
      <InvoiceEmailDialog
        {...s}
        isDraft={s.invoice?.status === 'draft'}
        peppolBlockers={s.peppolWarnings.filter((w) => w.severity === 'blocking')}
      />
    </>
  )

  return (
    <>
      <Box>
        <Box>
          {/* Wide: the labelled document buttons get a row of their own above the
              status actions. Compact: they collapse to one overflow button that
              rides along at the end of the status row instead. */}
          {documentActions && !isCompact && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              {documentActions}
            </Box>
          )}
          {s.invoice && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 2 }}>
              {s.invoice.status && (
                <Chip
                  size="small"
                  color={invoiceStatusColor(s.invoice.status) as 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'}
                  label={t($ => $.rawStatus[s.invoice!.status as InvoiceStatus])}
                />
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
                {canWrite && (
                  <InvoiceStatusActions
                    status={s.invoice.status ?? 'draft'}
                    disabled={s.saving}
                    onStatusChange={s.handleStatusChange}
                  />
                )}
                {isCompact && documentActions}
              </Box>
            </Box>
          )}
          {s.finalized && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t($ => $.detail.finalizedNotice)}
            </Alert>
          )}
          {s.error && <Alert severity="error" sx={{ mb: 2 }}>{s.error}</Alert>}
          {s.ublError && <Alert severity="error" sx={{ mb: 2 }}>{t($ => $.ubl.downloadFailed)}</Alert>}

          <InvoiceLogoHeader
            readOnly={s.readOnly}
            logoKey={logoKey}
            invoice={s.invoice ?? undefined}
            tenant={s.tenant ?? undefined}
            bandHeading={bandHeading}
            logoBusy={s.logoBusy}
            logoInputRef={s.logoInputRef}
            onLogoFile={s.handleLogoFile}
            onLogoRemove={s.handleLogoRemove}
            form={s.form}
            patchForm={s.patchForm}
          />

          <InvoiceCustomerFields
            form={s.form}
            patchForm={s.patchForm}
            readOnly={s.readOnly}
            memoOpen={s.memoOpen}
            setMemoOpen={s.setMemoOpen}
          />

          <Divider sx={{ my: 2 }} />

          <InvoiceLinesEditor
            form={s.form}
            totals={s.totals}
            appliesKor={s.appliesKor}
            readOnly={s.readOnly}
            patchForm={s.patchForm}
            patchLine={s.patchLine}
            addLine={s.addLine}
            removeLine={s.removeLine}
          />

          <Divider sx={{ my: 2 }} />

          <InvoiceTotalsPanel
            form={s.form}
            totals={s.totals}
            appliesKor={s.appliesKor}
            readOnly={s.readOnly}
            patchForm={s.patchForm}
            discountOpen={s.discountOpen}
            setDiscountOpen={s.setDiscountOpen}
          />

          {s.invoice && mollieConfigured && (
            <>
              <Divider sx={{ my: 2 }} />
              <PaymentLinkPanel
                invoice={s.invoice}
                canWrite={canWrite}
                onUpdated={(updated) => s.setInvoice({ ...s.invoice, ...updated } as Invoice)}
              />
            </>
          )}
        </Box>


        {/* Deleting sits alone at the foot of the page, away from the routine
            actions. On compact it is in the overflow menu instead, so this row
            would duplicate it. */}
        {canWrite && !s.finalized && !isCompact && (
          <>
            <Divider sx={{ mt: 3, mb: 2 }} />
            <Box sx={{ display: 'flex' }}>
              <Button color="error" onClick={() => { void s.handleDelete() }} startIcon={<DeleteIcon />}>
                {t($ => $.common.actions.delete)}
              </Button>
            </Box>
          </>
        )}
      </Box>
      {dialogs}
    </>
  )
}
