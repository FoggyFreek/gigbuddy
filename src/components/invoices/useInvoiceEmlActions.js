import { useState } from 'react'
import { downloadInvoiceEml, getInvoiceEmlDefaults } from '../../api/invoices.js'

// Owns the "download email (.eml)" dialog: fetching the default message and
// streaming the generated file. Self-contained — only needs the invoice id and
// the loaded invoice (for the download filename).
export function useInvoiceEmlActions({ invoiceId, invoice }) {
  const [emlDialogOpen, setEmlDialogOpen] = useState(false)
  const [emlMessage, setEmlMessage] = useState('')
  const [emlLoading, setEmlLoading] = useState(false)
  const [emlBusy, setEmlBusy] = useState(false)
  const [emlError, setEmlError] = useState(null)

  async function openEmlDialog() {
    setEmlDialogOpen(true)
    setEmlError(null)
    setEmlMessage('')
    setEmlLoading(true)
    try {
      const defaults = await getInvoiceEmlDefaults(invoiceId)
      setEmlMessage(defaults.personalMessage)
    } catch (err) {
      setEmlError(err.message)
    } finally {
      setEmlLoading(false)
    }
  }

  async function handleEmlDownload() {
    setEmlBusy(true)
    setEmlError(null)
    try {
      const blob = await downloadInvoiceEml(invoiceId, emlMessage)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeNumber = (invoice?.invoice_number || 'concept').replaceAll(/[^a-zA-Z0-9-]/g, '-')
      a.download = `factuur-${safeNumber}.eml`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setEmlDialogOpen(false)
    } catch (err) {
      setEmlError(err.message)
    } finally {
      setEmlBusy(false)
    }
  }

  return {
    emlDialogOpen,
    setEmlDialogOpen,
    emlMessage,
    setEmlMessage,
    emlLoading,
    emlBusy,
    emlError,
    openEmlDialog,
    handleEmlDownload,
  }
}
