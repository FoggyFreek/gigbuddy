import { useInvoiceFormState } from './useInvoiceFormState.js'
import { useInvoiceLogoActions } from './useInvoiceLogoActions.js'
import { useInvoiceEmlActions } from './useInvoiceEmlActions.js'

// Composes the focused invoice hooks into the single state object the detail
// view renders from. Each concern (form lifecycle, logo, EML) lives in its own
// hook; the logo/EML hooks read what they need from the form state.
export function useInvoiceDetailsState({ mode, draft, invoiceId, onClose, onInvoiceUpdate }) {
  const form = useInvoiceFormState({ mode, draft, invoiceId, onClose, onInvoiceUpdate })
  const logo = useInvoiceLogoActions({
    isEdit: form.isEdit,
    invoiceId,
    setInvoice: form.setInvoice,
    setError: form.setError,
  })
  const eml = useInvoiceEmlActions({ invoiceId, invoice: form.invoice })

  return { ...form, ...logo, ...eml }
}
