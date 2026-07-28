import { useState } from 'react'
import { downloadInvoiceUbl } from '../../api/invoices.ts'
import type { Invoice, Id } from '../../types/entities.ts'

interface UseInvoiceUblActionsArgs {
  invoiceId: Id
  invoice: Invoice | null
}

interface UseInvoiceUblActionsResult {
  ublBusy: boolean
  ublError: string | null
  handleUblDownload: () => Promise<void>
}

// Owns the "download UBL (XML)" action. No dialog — unlike the .eml there is
// nothing to compose. Like the .eml download this is a read, so it stays
// available to every finance viewer rather than requiring finance.manage.
export function useInvoiceUblActions({ invoiceId, invoice }: UseInvoiceUblActionsArgs): UseInvoiceUblActionsResult {
  const [ublBusy, setUblBusy] = useState(false)
  const [ublError, setUblError] = useState<string | null>(null)

  async function handleUblDownload() {
    setUblBusy(true)
    setUblError(null)
    try {
      const blob = await downloadInvoiceUbl(invoiceId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeNumber = (invoice?.invoice_number || 'concept').replaceAll(/[^a-zA-Z0-9-]/g, '-')
      a.download = `factuur-${safeNumber}.xml`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setUblError(err instanceof Error ? err.message : String(err))
    } finally {
      setUblBusy(false)
    }
  }

  return { ublBusy, ublError, handleUblDownload }
}
