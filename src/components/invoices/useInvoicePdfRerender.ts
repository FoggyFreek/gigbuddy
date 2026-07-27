import { useState } from 'react'
import { getInvoice, renderInvoice } from '../../api/invoices.ts'
import type { Invoice, Id } from '../../types/entities.ts'

interface UseInvoicePdfRerenderArgs {
  invoiceId: Id
  setInvoice: (invoice: Invoice) => void
  setError: (msg: string | null) => void
  /** false ⇒ the viewer lacks finance.manage, which the render route requires. */
  canWrite?: boolean
}

interface UseInvoicePdfRerenderResult {
  pdfRerenderBusy: boolean
  handlePdfRerender: () => Promise<void>
}

// Re-renders the stored PDF from the current invoice data. The invoice itself is
// never modified, so this stays available on a finalized invoice: a layout fix
// can be applied without voiding and re-issuing. The render endpoint answers with
// the new pdf_path only, so the full invoice is re-read afterwards (same as the
// logo actions) rather than overwriting the loaded one with a partial.
export function useInvoicePdfRerender({ invoiceId, setInvoice, setError, canWrite = true }: UseInvoicePdfRerenderArgs): UseInvoicePdfRerenderResult {
  const [pdfRerenderBusy, setPdfRerenderBusy] = useState(false)

  async function handlePdfRerender() {
    if (!canWrite) return
    try {
      setPdfRerenderBusy(true)
      setError(null)
      await renderInvoice(invoiceId)
      const refreshed = await getInvoice(invoiceId)
      setInvoice(refreshed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPdfRerenderBusy(false)
    }
  }

  return { pdfRerenderBusy, handlePdfRerender }
}
