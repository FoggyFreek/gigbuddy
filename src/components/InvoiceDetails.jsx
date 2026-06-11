import PropTypes from 'prop-types'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import DownloadIcon from '@mui/icons-material/Download'
import EmailIcon from '@mui/icons-material/Email'
import DeleteIcon from '@mui/icons-material/Delete'
import { invoiceStatusColor } from '../utils/invoiceStatus.js'
import { idProp } from '../propTypes/shared.js'
import { useInvoiceDetailsState } from './invoices/useInvoiceDetailsState.js'
import InvoiceLogoHeader from './invoices/InvoiceLogoHeader.jsx'
import InvoiceCustomerFields from './invoices/InvoiceCustomerFields.jsx'
import InvoiceLinesEditor from './invoices/InvoiceLinesEditor.jsx'
import InvoiceTotalsPanel from './invoices/InvoiceTotalsPanel.jsx'
import InvoiceDeleteDialog from './invoices/InvoiceDeleteDialog.jsx'
import InvoiceVoidDialog from './invoices/InvoiceVoidDialog.jsx'
import InvoiceEmlDialog from './invoices/InvoiceEmlDialog.jsx'
import PaymentLinkPanel from './invoices/PaymentLinkPanel.jsx'

export default function InvoiceDetails({ invoiceId, onClose, onInvoiceUpdate }) {
  const s = useInvoiceDetailsState({ invoiceId, onClose, onInvoiceUpdate })

  if (s.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  const logoKey = s.invoice?.custom_logo_path || s.tenant?.logo_path
  const bandHeading = s.tenant?.formal_name || s.tenant?.band_name || ''

  const dialogs = (
    <>
      <InvoiceDeleteDialog
        open={s.deleteDialogOpen}
        invoiceNumber={s.invoice?.invoice_number}
        onCancel={() => s.setDeleteDialogOpen(false)}
        onConfirm={s.confirmDelete}
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
        error={s.emlError}
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box sx={{ flexGrow: 1 }}>
            Invoice {s.invoice?.invoice_number || ''}
          </Box>
          {s.invoice && (
            <Chip size="small" color={invoiceStatusColor(s.invoice.status)} label={s.invoice.status} />
          )}
        </Box>
        <Divider sx={{ mb: 2 }} />

        <Box>
          {s.finalized && (
            <Alert severity="info" sx={{ mb: 2 }}>
              This invoice is finalized. Voiding and re-issuing is required to make corrections.
            </Alert>
          )}
          {s.error && <Alert severity="error" sx={{ mb: 2 }}>{s.error}</Alert>}

          <InvoiceLogoHeader
            readOnly={s.readOnly}
            logoKey={logoKey}
            invoice={s.invoice}
            tenant={s.tenant}
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
            invoice={s.invoice}
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
                onUpdated={(updated) => s.setInvoice((prev) => ({ ...prev, ...updated }))}
              />
            </>
          )}
        </Box>

        <Divider sx={{ mt: 3, mb: 2 }} />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            {!s.finalized && (
              <Button color="error" onClick={s.handleDelete} startIcon={<DeleteIcon />}>
                Delete
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
                Download PDF
              </Button>
            )}
            {s.invoice && (
              <Button startIcon={<EmailIcon />} onClick={s.openEmlDialog}>
                Download email
              </Button>
            )}
            <Button onClick={() => onClose(false)}>Close</Button>
            {!s.readOnly && (
              <Button variant="contained" onClick={s.handleSave} disabled={s.saving}>
                {s.saving ? 'Saving...' : 'Save changes'}
              </Button>
            )}
          </Box>
        </Box>
      </Box>
      {dialogs}
    </>
  )
}

InvoiceDetails.propTypes = {
  invoiceId: idProp.isRequired,
  onClose: PropTypes.func.isRequired,
  onInvoiceUpdate: PropTypes.func,
}
