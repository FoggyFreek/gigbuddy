// Pulls the CII invoice out of a Factur-X / ZUGFeRD 2.x PDF.
//
// These are hybrid documents: a PDF/A-3 a person can read, carrying the machine
// -readable CII XML as an embedded file. France and Germany both lean on them —
// Factur-X is the French reform's format and ZUGFeRD 2.x is its German twin
// (the two are the same specification under two names).
//
// ZUGFeRD 1.0 is deliberately NOT supported: it predates the convergence, uses
// a different namespace and element tree, and was superseded in 2019. Its
// filename is still recognised so the failure can say so.
//
// Only the container is handled here. The XML that comes out goes through the
// ordinary CII reader, so a Factur-X invoice and a plain .xml CII invoice are
// read by exactly the same code.
import { EInvoiceParseError } from './nodes.js'

const PDF_MAGIC = Buffer.from('%PDF-')

/** True when the buffer is a PDF, whatever the upload claimed it was. */
export function isPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)
}

// The filenames the specifications mandate for the embedded XML. Matched
// case-insensitively: the spec fixes the case but real files vary.
const FACTUR_X_NAMES = new Set(['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml', 'order-x.xml'])
const ZUGFERD_1_NAME = 'zugferd-invoice.xml'

// pdfjs is a rendering library; this uses only its document layer. No worker (a
// worker would need a separate entry point in Node and buys nothing for a
// metadata read) and no eval, which its own docs recommend disabling when the
// input is untrusted — and an uploaded invoice is exactly that.
async function loadPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  }).promise
}

/**
 * The embedded CII XML, as a string.
 *
 * @throws {EInvoiceParseError} when the PDF carries no e-invoice XML — which is
 *   what an ordinary scanned or printed PDF invoice looks like, and is a normal
 *   thing for a user to try.
 */
export async function extractFacturXml(buffer) {
  let attachments
  try {
    const pdf = await loadPdf(buffer)
    attachments = await pdf.getAttachments()
  } catch (err) {
    throw new EInvoiceParseError(`could not read the PDF: ${err.message}`)
  }

  const entries = Object.entries(attachments ?? {})
  const match = entries.find(([name]) => FACTUR_X_NAMES.has(name.trim().toLowerCase()))
  if (!match) {
    throw new EInvoiceParseError(
      'this PDF carries no e-invoice data. Only Factur-X / ZUGFeRD 2.x PDFs can be imported — '
      + 'for an ordinary PDF invoice, create the purchase and attach the file to it',
    )
  }

  const [name, file] = match
  const xml = Buffer.from(file.content).toString('utf8')
  // ZUGFeRD 1.0 uses the same filename as 2.x but a different, superseded tree.
  // Recognised only so the message can name the version rather than complain
  // about an unfamiliar root element.
  if (name.trim().toLowerCase() === ZUGFERD_1_NAME && xml.includes('urn:ferd:CrossIndustryDocument')) {
    throw new EInvoiceParseError('ZUGFeRD 1.0 is not supported — ask the supplier for ZUGFeRD 2.x or Factur-X')
  }
  return xml
}
