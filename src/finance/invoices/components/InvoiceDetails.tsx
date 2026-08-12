import { useEffect } from 'react'
import { useCompactLayout } from '../../../hooks/useCompactLayout.ts'
import type { Id, Invoice, InvoiceStatus } from '../../../types/entities.ts'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
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
import InvoiceDeleteDialog from './InvoiceDeleteDialog.tsx'
import InvoicePaidDialog from './InvoicePaidDialog.tsx'
import InvoiceSentDialog from './InvoiceSentDialog.tsx'
import InvoiceVoidDialog from './InvoiceVoidDialog.tsx'
import InvoiceStatusActions from './InvoiceStatusActions.tsx'
import InvoiceEmlDialog from './InvoiceEmlDialog.tsx'
import PaymentLinkPanel from './PaymentLinkPanel.tsx'
import InvoiceDownloadMenu from './InvoiceDownloadMenu.tsx'
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
  const s = useInvoiceDetailsState({ invoiceId, onClose, onInvoiceUpdate, canWrite })
  const isCompact = useCompactLayout()
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

  // Every way the invoice leaves the app sits behind one control. All three are
  // reads, so they stay available to every finance viewer.
  //
  // Re-generating the PDF is deliberately NOT in that menu: it is a mutation
  // behind finance.manage, not a download. It never touches the invoice *data*,
  // so it stays available on a finalized invoice — a rendering fix lands without
  // voiding and re-issuing.
  const documentActions = s.invoice ? (
    <>
      <InvoiceDownloadMenu
        pdfPath={s.invoice.pdf_path}
        onDownloadUbl={s.handleUblDownload}
        onDownloadUblWithPdf={s.handleUblWithPdfDownload}
        ublBusy={s.ublBusy}
        onOpenEmailDialog={s.openEmlDialog}
        peppolBlockers={s.peppolWarnings.filter((w) => w.severity === 'blocking')}
      />
      {s.invoice.pdf_path && canWrite && (
        <Tooltip title={t($ => $.pdf.rerender)}>
          <IconButton
            size="small"
            color="primary"
            onClick={s.handlePdfRerender}
            disabled={s.pdfRerenderBusy}
            aria-label={t($ => $.pdf.rerenderAria)}
          >
            {s.pdfRerenderBusy ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      )}
    </>
  ) : null

  const dialogs = (
    <>
      <InvoiceDeleteDialog
        open={s.deleteDialogOpen}
        invoiceNumber={s.invoice?.invoice_number}
        onCancel={() => s.setDeleteDialogOpen(false)}
        onConfirm={s.confirmDelete}
      />
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
      <InvoiceEmlDialog
        open={s.emlDialogOpen}
        loading={s.emlLoading}
        busy={s.emlBusy}
        error={s.emlError ?? undefined}
        message={s.emlMessage}
        onMessageChange={s.setEmlMessage}
        onClose={() => s.setEmlDialogOpen(false)}
        onDownload={s.handleEmlDownload}
      />
    </>
  )

  return (
    <>
      <Box>
        <Box>
          {s.invoice && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 2 }}>
              {s.invoice.status && (
                <Chip
                  size="small"
                  color={invoiceStatusColor(s.invoice.status) as 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'}
                  label={t($ => $.rawStatus[s.invoice!.status as InvoiceStatus])}
                />
              )}
              {canWrite && (
                <Box sx={{ ml: 'auto' }}>
                  <InvoiceStatusActions
                    status={s.invoice.status ?? 'draft'}
                    disabled={s.saving}
                    onStatusChange={s.handleStatusChange}
                  />
                </Box>
              )}
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

        <Divider sx={{ mt: 3, mb: 2 }} />
        {isCompact ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {documentActions && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>{documentActions}</Box>
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center' }}>
              <Box>
                {canWrite && !s.finalized && (
                  <Button color="error" onClick={s.handleDelete} startIcon={<DeleteIcon />}>
                    {t($ => $.common.actions.delete)}
                  </Button>
                )}
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                <Button onClick={() => onClose(false)}>{t($ => $.common.actions.close)}</Button>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                {!s.readOnly && (
                  <Button variant="contained" onClick={s.handleSave} disabled={s.saving}>
                    {s.saving ? t($ => $.detail.saving) : t($ => $.detail.saveChanges)}
                  </Button>
                )}
              </Box>
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              {canWrite && !s.finalized && (
                <Button color="error" onClick={s.handleDelete} startIcon={<DeleteIcon />}>
                  {t($ => $.common.actions.delete)}
                </Button>
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {documentActions}
              <Button onClick={() => onClose(false)}>{t($ => $.common.actions.close)}</Button>
              {!s.readOnly && (
                <Button variant="contained" onClick={s.handleSave} disabled={s.saving}>
                  {s.saving ? t($ => $.detail.saving) : t($ => $.detail.saveChanges)}
                </Button>
              )}
            </Box>
          </Box>
        )}
      </Box>
      {dialogs}
    </>
  )
}
