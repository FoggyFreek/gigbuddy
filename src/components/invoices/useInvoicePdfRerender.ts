import { useState } from 'react'
import { renderInvoice } from '../../api/invoices.ts'
import type { Invoice, Id } from '../../types/entities.ts'

interface UseInvoicePdfRerenderArgs {
  invoiceId: Id
  setInvoice: (invoice: Invoice) => void
  setError: (error: string | null) => void
}

interface UseInvoicePdfRerenderResult {
  pdfRerenderBusy: boolean
  handlePdfRerender: () => Promise<void>
}

export function useInvoicePdfRerender({ invoiceId, setInvoice, setError }: UseInvoicePdfRerenderArgs): UseInvoicePdfRerenderResult {
  const [pdfRerenderBusy, setPdfRerenderBusy] = useState(false)

  async function handlePdfRerender() {
    setPdfRerenderBusy(true)
    setError(null)
    try {
      const updated = await renderInvoice(invoiceId)
      setInvoice(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPdfRerenderBusy(false)
    }
  }

  return {
    pdfRerenderBusy,
    handlePdfRerender,
  }
}
