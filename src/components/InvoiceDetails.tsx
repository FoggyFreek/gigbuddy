import { useEffect } from 'react'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import type { Id, Invoice, InvoiceStatus } from '../types/entities.ts'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import DownloadIcon from '@mui/icons-material/Download'
import EmailIcon from '@mui/icons-material/Email'
import DeleteIcon from '@mui/icons-material/Delete'
import { invoiceStatusColor } from '../utils/invoiceStatus.ts'
import { useInvoiceDetailsState } from './invoices/useInvoiceDetailsState.ts'
import InvoiceLogoHeader from './invoices/InvoiceLogoHeader.tsx'
import InvoiceCustomerFields from './invoices/InvoiceCustomerFields.tsx'
import InvoiceLinesEditor from './invoices/InvoiceLinesEditor.tsx'
import InvoiceTotalsPanel from './invoices/InvoiceTotalsPanel.tsx'
import InvoiceDeleteDialog from './invoices/InvoiceDeleteDialog.tsx'
import InvoicePaidDialog from './invoices/InvoicePaidDialog.tsx'
import InvoiceVoidDialog from './invoices/InvoiceVoidDialog.tsx'
import InvoiceEmlDialog from './invoices/InvoiceEmlDialog.tsx'
import PaymentLinkPanel from './invoices/PaymentLinkPanel.tsx'

interface InvoiceDetailsProps {
  invoiceId: Id
  onClose: (updated?: boolean) => void
  onInvoiceUpdate?: (id: Id, patch: Partial<Invoice>) => void
  onTitleReady?: (title: string) => void
}

export default function InvoiceDetails({ invoiceId, onClose, onInvoiceUpdate, onTitleReady }: InvoiceDetailsProps) {
  const { t } = useTranslation(['invoices', 'common'])
  const s = useInvoiceDetailsState({ invoiceId, onClose, onInvoiceUpdate })
  const isCompact = useCompactLayout()

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

  const dialogs = (
    <>
      <InvoiceDeleteDialog
        open={s.deleteDialogOpen}
        invoiceNumber={s.invoice?.invoice_number}
        onCancel={() => s.setDeleteDialogOpen(false)}
        onConfirm={s.confirmDelete}
      />
      <InvoicePaidDialog
        open={s.paidDialogOpen}
        invoiceNumber={s.invoice?.invoice_number}
        onCancel={() => s.setPaidDialogOpen(false)}
        onConfirm={s.confirmPaid}
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
          {s.invoice?.status && (
            <Chip
              size="small"
              color={invoiceStatusColor(s.invoice.status) as 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'}
              label={t($ => $.rawStatus[s.invoice!.status as InvoiceStatus])}
              sx={{ mb: 2 }}
            />
          )}
          {s.finalized && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t($ => $.detail.finalizedNotice)}
            </Alert>
          )}
          {s.error && <Alert severity="error" sx={{ mb: 2 }}>{s.error}</Alert>}

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
            invoice={s.invoice ?? undefined}
            onStatusChange={s.handleStatusChange}
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

          {s.invoice && (
            <>
              <Divider sx={{ my: 2 }} />
              <PaymentLinkPanel
                invoice={s.invoice}
                onUpdated={(updated) => s.setInvoice({ ...s.invoice, ...updated } as Invoice)}
              />
            </>
          )}
        </Box>

        <Divider sx={{ mt: 3, mb: 2 }} />
        {isCompact ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {s.invoice?.pdf_path ? (
                <Button
                  component="a"
                  href={`/api/files/${s.invoice.pdf_path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  startIcon={<DownloadIcon />}
                >
                  {t($ => $.pdf.download)}
                </Button>
              ) : <Box />}
              {s.invoice && (
                <Button startIcon={<EmailIcon />} onClick={s.openEmlDialog}>
                  {t($ => $.detail.downloadEmail)}
                </Button>
              )}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', alignItems: 'center' }}>
              <Box>
                {!s.finalized && (
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
              {!s.finalized && (
                <Button color="error" onClick={s.handleDelete} startIcon={<DeleteIcon />}>
                  {t($ => $.common.actions.delete)}
                </Button>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {s.invoice?.pdf_path && (
                <Button
                  component="a"
                  href={`/api/files/${s.invoice.pdf_path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  startIcon={<DownloadIcon />}
                >
                  {t($ => $.pdf.download)}
                </Button>
              )}
              {s.invoice && (
                <Button startIcon={<EmailIcon />} onClick={s.openEmlDialog}>
                  {t($ => $.detail.downloadEmail)}
                </Button>
              )}
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
