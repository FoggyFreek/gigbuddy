import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import {
  createInvoiceEmailCampaign, downloadInvoiceEml, getInvoiceEmailDefaults,
  previewInvoiceEmail, sendInvoiceEmailCampaign,
  type InvoiceAttachmentMode, type InvoiceEmailTemplateOption,
} from '../invoices.ts'
import { getOutreachSender } from '../../../promotion/outreach/outreachSender.ts'
import type { Invoice, Id } from '../../../types/entities.ts'

interface Args {
  invoiceId: Id
  invoice: Invoice | null
  onInvoiceChange?: (invoice: Invoice) => void
  markSent?: () => Promise<void>
}

export interface UseInvoiceEmailActionsResult {
  emailDialogOpen: boolean
  openEmailDialog: () => Promise<void>
  closeEmailDialog: () => void
  emailTemplates: InvoiceEmailTemplateOption[]
  emailTemplateId: Id | null
  setEmailTemplateId: (id: Id) => void
  emailMessage: string
  setEmailMessage: (value: string) => void
  emailAttachments: InvoiceAttachmentMode
  setEmailAttachments: (value: InvoiceAttachmentMode) => void
  emailMarkSent: boolean
  setEmailMarkSent: (value: boolean) => void
  emailPreviewHtml: string
  emailPreviewSubject: string
  emailPreviewLoading: boolean
  emailLoading: boolean
  emailBusy: boolean
  emailError: string | null
  emailSent: boolean
  senderConfigured: boolean
  handleEmailDownload: () => Promise<void>
  handleEmailSend: () => Promise<void>
}

const PREVIEW_DEBOUNCE_MS = 400
const message = (err: unknown) => err instanceof Error ? err.message : String(err)

function filenameFromDisposition(header: string | null, fallback: string) {
  const match = header ? /filename="([^"]+)"/.exec(header) : null
  return match ? match[1] : fallback
}

// Owns the invoice "send email" dialog: template choice, custom message,
// attachment choice, the debounced server-rendered preview, and the two exits
// (download the .eml, or send it through Resend).
export function useInvoiceEmailActions({ invoiceId, invoice, markSent }: Args): UseInvoiceEmailActionsResult {
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [emailTemplates, setEmailTemplates] = useState<InvoiceEmailTemplateOption[]>([])
  const [emailTemplateId, setEmailTemplateId] = useState<Id | null>(null)
  const [emailMessage, setEmailMessage] = useState('')
  const [emailAttachments, setEmailAttachments] = useState<InvoiceAttachmentMode>('pdf')
  const [emailMarkSent, setEmailMarkSent] = useState(false)
  const [emailPreviewHtml, setEmailPreviewHtml] = useState('')
  const [emailPreviewSubject, setEmailPreviewSubject] = useState('')
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)
  const [senderConfigured, setSenderConfigured] = useState(false)

  async function openEmailDialog() {
    setEmailDialogOpen(true)
    setEmailError(null)
    setEmailSent(false)
    setEmailPreviewHtml('')
    setEmailMarkSent(false)
    setEmailAttachments('pdf')
    setEmailLoading(true)
    try {
      const [defaults, sender] = await Promise.all([
        getInvoiceEmailDefaults(invoiceId),
        // Sending needs a verified Resend sender; without one only the download
        // is offered.
        getOutreachSender().catch(() => null),
      ])
      setEmailTemplates(defaults.templates)
      setEmailTemplateId(defaults.templates[0]?.id ?? null)
      setEmailMessage(defaults.message ?? '')
      setSenderConfigured(Boolean(sender?.configured))
    } catch (err) {
      setEmailError(message(err))
    } finally {
      setEmailLoading(false)
    }
  }

  function closeEmailDialog() {
    setEmailDialogOpen(false)
  }

  // Debounced so typing a message doesn't re-render the email on every keystroke.
  useEffect(() => {
    if (!emailDialogOpen || emailLoading || emailTemplateId === null) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      // Set inside the callback, not the effect body: a synchronous setState here
      // would cascade a render on every keystroke.
      setEmailPreviewLoading(true)
      previewInvoiceEmail(invoiceId, { templateId: emailTemplateId, message: emailMessage })
        .then((preview) => {
          if (cancelled) return
          setEmailPreviewHtml(DOMPurify.sanitize(preview.html))
          setEmailPreviewSubject(preview.subject)
        })
        .catch((err: unknown) => { if (!cancelled) setEmailError(message(err)) })
        .finally(() => { if (!cancelled) setEmailPreviewLoading(false) })
    }, PREVIEW_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [emailDialogOpen, emailLoading, emailTemplateId, emailMessage, invoiceId])

  function body() {
    return {
      templateId: emailTemplateId ?? undefined,
      message: emailMessage,
      attachments: emailAttachments,
    }
  }

  // Finalizing first means the attachment is the finalized PDF; a send that fails
  // afterwards is recoverable by sending again, while un-finalizing is not.
  async function finalizeIfRequested() {
    if (!emailMarkSent || !markSent) return true
    try {
      await markSent()
      return true
    } catch (err) {
      setEmailError(message(err))
      return false
    }
  }

  async function handleEmailDownload() {
    if (emailBusy) return
    setEmailBusy(true)
    setEmailError(null)
    try {
      if (!await finalizeIfRequested()) return
      const { blob, headers } = await downloadInvoiceEml(invoiceId, body())
      const header = headers.get('content-disposition')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filenameFromDisposition(header, `invoice-${invoice?.invoice_number ?? 'concept'}.eml`)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setEmailDialogOpen(false)
    } catch (err) {
      setEmailError(message(err))
    } finally {
      setEmailBusy(false)
    }
  }

  async function handleEmailSend() {
    if (emailBusy) return
    setEmailBusy(true)
    setEmailError(null)
    let finalized = false
    try {
      if (!await finalizeIfRequested()) return
      finalized = emailMarkSent
      const campaign = await createInvoiceEmailCampaign(invoiceId, body())
      await sendInvoiceEmailCampaign(invoiceId, campaign.id)
      setEmailSent(true)
      setEmailDialogOpen(false)
    } catch (err) {
      setEmailError(finalized
        ? `${message(err)} (the invoice was marked as sent)`
        : message(err))
    } finally {
      setEmailBusy(false)
    }
  }

  return {
    emailDialogOpen, openEmailDialog, closeEmailDialog,
    emailTemplates, emailTemplateId, setEmailTemplateId,
    emailMessage, setEmailMessage,
    emailAttachments, setEmailAttachments,
    emailMarkSent, setEmailMarkSent,
    emailPreviewHtml, emailPreviewSubject, emailPreviewLoading,
    emailLoading, emailBusy, emailError, emailSent, senderConfigured,
    handleEmailDownload, handleEmailSend,
  }
}
