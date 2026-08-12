import { useRef, useState } from 'react'
import { getInvoice, removeInvoiceLogo, uploadInvoiceLogo } from '../invoices.ts'
import { compressLogo } from '../../../utils/compressImage.ts'
import type { Invoice, Id } from '../../../types/entities.ts'

interface UseInvoiceLogoActionsArgs {
  invoiceId: Id
  setInvoice: (invoice: Invoice) => void
  setError: (msg: string | null) => void
  /** false ⇒ the viewer lacks finance.manage; logo upload/remove is refused. */
  canWrite?: boolean
}

interface UseInvoiceLogoActionsResult {
  logoBusy: boolean
  logoInputRef: React.RefObject<HTMLInputElement | null>
  handleLogoFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  handleLogoRemove: () => Promise<void>
}

// Custom-logo upload/remove for an invoice. Reports the refreshed invoice and
// any error back through the form-state setters it is given.
export function useInvoiceLogoActions({ invoiceId, setInvoice, setError, canWrite = true }: UseInvoiceLogoActionsArgs): UseInvoiceLogoActionsResult {
  const [logoBusy, setLogoBusy] = useState(false)
  const logoInputRef = useRef<HTMLInputElement | null>(null)

  async function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !canWrite) return
    try {
      setLogoBusy(true)
      setError(null)
      await uploadInvoiceLogo(invoiceId, await compressLogo(file))
      const refreshed = await getInvoice(invoiceId)
      setInvoice(refreshed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLogoBusy(false)
    }
  }

  async function handleLogoRemove() {
    if (!canWrite) return
    try {
      setLogoBusy(true)
      await removeInvoiceLogo(invoiceId)
      const refreshed = await getInvoice(invoiceId)
      setInvoice(refreshed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLogoBusy(false)
    }
  }

  return { logoBusy, logoInputRef, handleLogoFile, handleLogoRemove }
}
