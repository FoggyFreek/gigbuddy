import { useRef, useState } from 'react'
import { getInvoice, removeInvoiceLogo, uploadInvoiceLogo } from '../../api/invoices.js'

// Custom-logo upload/remove for an invoice. Reports the refreshed invoice and
// any error back through the form-state setters it is given.
export function useInvoiceLogoActions({ isEdit, invoiceId, setInvoice, setError }) {
  const [logoBusy, setLogoBusy] = useState(false)
  const logoInputRef = useRef(null)

  async function handleLogoFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!isEdit) {
      setError('Save the invoice first, then upload a custom logo.')
      return
    }
    try {
      setLogoBusy(true)
      setError(null)
      await uploadInvoiceLogo(invoiceId, file)
      const refreshed = await getInvoice(invoiceId)
      setInvoice(refreshed)
    } catch (err) {
      setError(err.message)
    } finally {
      setLogoBusy(false)
    }
  }

  async function handleLogoRemove() {
    if (!isEdit) return
    try {
      setLogoBusy(true)
      await removeInvoiceLogo(invoiceId)
      const refreshed = await getInvoice(invoiceId)
      setInvoice(refreshed)
    } catch (err) {
      setError(err.message)
    } finally {
      setLogoBusy(false)
    }
  }

  return { logoBusy, logoInputRef, handleLogoFile, handleLogoRemove }
}
