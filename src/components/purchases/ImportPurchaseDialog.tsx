import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import { importPurchaseDocument } from '../../api/purchases.ts'
import { formatEur } from '../../utils/purchaseTotals.ts'
import { isApiError, type ApiError } from '../../types/api.ts'
import type { Id, PurchaseImportResult, PurchaseImportWarning } from '../../types/entities.ts'

type Translate = ReturnType<typeof useTranslation<['purchases', 'common']>>['t']

// The one rejection worth rephrasing: a bill already in the books is a normal
// thing to hit, and naming the purchase it clashes with is more use than the
// server's generic sentence.
function describeFailure(e: unknown, t: Translate): string {
  if (isApiError(e) && e.code === 'supplier_invoice_number_taken') {
    const receipts = (e as ApiError & { receipt_numbers?: number[] }).receipt_numbers ?? []
    return t($ => $.importDialog.alreadyImported, { receipts: receipts.join(', ') })
  }
  return (e as Error).message
}

// Uploads a supplier's UBL e-invoice and reports what came back before handing
// the draft to the detail editor.
//
// The draft is created by the upload, not by a second confirmation step: it
// posts nothing to the ledger and stays deletable, so the editor the user lands
// in IS the review. What this dialog adds is the part the editor cannot show —
// the inferences the importer had to make, which are invisible once the values
// are sitting in form fields.

interface ImportPurchaseDialogProps {
  onClose: () => void
  onImported: (id: Id) => void
}

export default function ImportPurchaseDialog({ onClose, onImported }: Readonly<ImportPurchaseDialogProps>) {
  const { t } = useTranslation(['purchases', 'common'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PurchaseImportResult | null>(null)

  async function handleFile(file: File) {
    try {
      setBusy(true)
      setError(null)
      setResult(await importPurchaseDocument(file))
    } catch (e) {
      setError(describeFailure(e, t))
    } finally {
      setBusy(false)
    }
  }

  const blocking = result?.warnings.filter((w) => w.severity === 'blocking') ?? []
  const advisory = result?.warnings.filter((w) => w.severity === 'advisory') ?? []

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t($ => $.importDialog.title)}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {busy && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        )}

        {!busy && !result && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t($ => $.importDialog.description)}
            </Typography>
            <Button component="label" variant="contained" startIcon={<UploadFileIcon />}>
              {t($ => $.importDialog.chooseFile)}
              <input
                type="file"
                accept=".xml,text/xml,application/xml"
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              {t($ => $.importDialog.fileHint)}
            </Typography>
          </Box>
        )}

        {!busy && result && (
          <>
            <Alert severity="success" sx={{ mb: 2 }}>
              <AlertTitle>{t($ => $.importDialog.created)}</AlertTitle>
              {t($ => $.importDialog.summary, {
                supplier: result.purchase.supplier_name ?? '',
                total: formatEur(result.purchase.total_cents ?? 0),
                count: result.purchase.lines?.length ?? 0,
              })}
            </Alert>
            {blocking.length > 0 && (
              <WarningList
                severity="warning"
                title={t($ => $.importDialog.checkBeforeApproving)}
                warnings={blocking}
              />
            )}
            {advisory.length > 0 && (
              <WarningList
                severity="info"
                title={t($ => $.importDialog.adjustments)}
                warnings={advisory}
              />
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {result ? t($ => $.common.actions.close) : t($ => $.common.actions.cancel)}
        </Button>
        {result && (
          <Button variant="contained" onClick={() => onImported(result.purchase.id!)}>
            {t($ => $.importDialog.openDraft)}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

function WarningList({ severity, title, warnings }: Readonly<{
  severity: 'warning' | 'info'
  title: string
  warnings: PurchaseImportWarning[]
}>) {
  const { t } = useTranslation('purchases')
  return (
    <Alert severity={severity} sx={{ mb: 2 }}>
      <AlertTitle>{title}</AlertTitle>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {warnings.map((w) => (
          <li key={w.code}>
            {t($ => $.importDialog.warnings[w.code], {
              from: w.from,
              to: w.to,
              amount: formatEur(Math.abs(w.cents ?? 0)),
              stated: formatEur(w.statedCents ?? 0),
              receipts: (w.receiptNumbers ?? []).join(', '),
              defaultValue: w.code,
            })}
          </li>
        ))}
      </Box>
    </Alert>
  )
}
