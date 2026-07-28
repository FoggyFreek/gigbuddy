import { useInvoiceFormState } from './useInvoiceFormState.ts'
import { useInvoiceLogoActions } from './useInvoiceLogoActions.ts'
import { useInvoiceEmlActions } from './useInvoiceEmlActions.ts'
import { useInvoiceUblActions } from './useInvoiceUblActions.ts'
import { useInvoicePdfRerender } from './useInvoicePdfRerender.ts'
import type { Id, Invoice } from '../../types/entities.ts'

interface UseInvoiceDetailsStateArgs {
  invoiceId: Id
  onClose: (updated?: boolean) => void
  onInvoiceUpdate?: (id: Id, patch: Partial<Invoice>) => void
  /** false ⇒ the viewer lacks finance.manage; every mutation is refused. */
  canWrite?: boolean
}

// Composes the focused invoice hooks into the single state object the detail
// view renders from. Each concern (form lifecycle, logo, EML, PDF rerender) lives in its own
// hook; the logo/EML/PDF hooks read what they need from the form state.
export function useInvoiceDetailsState({ invoiceId, onClose, onInvoiceUpdate, canWrite = true }: UseInvoiceDetailsStateArgs) {
  const form = useInvoiceFormState({ invoiceId, onClose, onInvoiceUpdate, canWrite })
  const logo = useInvoiceLogoActions({
    invoiceId,
    setInvoice: form.setInvoice,
    setError: form.setError,
    canWrite,
  })
  // Downloading the .eml is a read affordance — the route carries no
  // finance.manage gate, so it stays available to every finance viewer.
  const eml = useInvoiceEmlActions({ invoiceId, invoice: form.invoice })
  // Same for the UBL/Peppol XML — a read, no finance.manage gate.
  const ubl = useInvoiceUblActions({ invoiceId, invoice: form.invoice })
  const pdfRerender = useInvoicePdfRerender({
    invoiceId,
    setInvoice: form.setInvoice,
    setError: form.setError,
    canWrite,
  })

  return { ...form, ...logo, ...eml, ...ubl, ...pdfRerender }
}
