import { useInvoiceFormState } from './useInvoiceFormState.ts'
import { useInvoiceLogoActions } from './useInvoiceLogoActions.ts'
import { useInvoiceEmlActions } from './useInvoiceEmlActions.ts'
import type { Id, Invoice } from '../../types/entities.ts'

interface UseInvoiceDetailsStateArgs {
  invoiceId: Id
  onClose: (updated?: boolean) => void
  onInvoiceUpdate?: (id: Id, patch: Partial<Invoice>) => void
}

// Composes the focused invoice hooks into the single state object the detail
// view renders from. Each concern (form lifecycle, logo, EML) lives in its own
// hook; the logo/EML hooks read what they need from the form state.
export function useInvoiceDetailsState({ invoiceId, onClose, onInvoiceUpdate }: UseInvoiceDetailsStateArgs) {
  const form = useInvoiceFormState({ invoiceId, onClose, onInvoiceUpdate })
  const logo = useInvoiceLogoActions({
    invoiceId,
    setInvoice: form.setInvoice,
    setError: form.setError,
  })
  const eml = useInvoiceEmlActions({ invoiceId, invoice: form.invoice })

  return { ...form, ...logo, ...eml }
}
