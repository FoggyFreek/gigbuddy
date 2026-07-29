// Reads any supported e-invoice into ONE normalized document, whatever syntax
// or container it arrived in. Pure: no DB, no IO beyond the buffer handed in.
//
// EN 16931 is a semantic model with two syntax bindings, and one of those
// syntaxes also travels inside a PDF, so there are three ways the same invoice
// can reach us:
//
//   .xml  UBL 2.1 Invoice              ubl.js    (NL/BE Peppol BIS, SI-UBL, XRechnung-UBL)
//   .xml  UN/CEFACT CII D16B           cii.js    (XRechnung-CII)
//   .pdf  Factur-X / ZUGFeRD 2.x       facturx.js -> cii.js   (FR, DE)
//
// Everything downstream — eInvoiceToPurchase.js, the import service, the route,
// the dialog — consumes the normalized document and never learns which of these
// it was. That is the whole point of this module: adding a syntax must not
// ripple past this directory.
//
// THE NORMALIZED DOCUMENT
//   {
//     syntax, invoiceNumber, typeCode, customizationId,
//     issueDate, dueDate, currency, note, buyerReference, orderReference,
//     supplier, customer,          // { name, vatId, registrationId, endpointId,
//                                  //   email, country, street, postalCode, city }
//     payeeIban,
//     lines: [{ id, description, quantity, unitCode, netCents, category }],
//                                  // category: { code, percent } | null
//                                  // MAY BE EMPTY — see Factur-X MINIMUM below
//     allowanceCharges: [{ kind, cents, reason, category }],
//     vatBreakdown: [{ taxableCents, taxCents, category }],
//     totals: { lineExtensionCents, taxExclusiveCents, taxInclusiveCents,
//               allowanceTotalCents, chargeTotalCents, prepaidCents,
//               roundingCents, payableCents, taxCents },
//     attachments: [{ mimeCode, filename, bytes }],
//   }
//
// Amounts are integer cents; dates are YYYY-MM-DD. Every field EN 16931 makes
// mandatory is guaranteed non-null — the readers throw rather than default, so
// nothing downstream has to guess whether a zero is real.
//
// EMPTY `lines` IS LEGITIMATE, not a parse failure. Factur-X MINIMUM and
// BASIC WL are accounting-only profiles that carry totals and no line detail,
// and MINIMUM is the floor mandated by the French reform, so they arrive in
// normal use. eInvoiceToPurchase.js synthesizes a single line from the totals
// and flags it, because a purchase must have at least one.
import { decodeUploadedText } from '../decodeText.js'
import { EInvoiceParseError, readRootElement } from './nodes.js'
import { UBL_CREDIT_NOTE_NS, UBL_INVOICE_NS, parseUblInvoice } from './ubl.js'
import { CII_NS, parseCiiInvoice } from './cii.js'
import { extractFacturXml, isPdf } from './facturx.js'

export { EInvoiceParseError } from './nodes.js'

// Roots we recognise well enough to explain, but will not import. Saying which
// document this is beats "unrecognized format" when the user is holding a credit
// note or an Italian national invoice and wondering why it bounced.
const REFUSED_ROOTS = new Map([
  [UBL_CREDIT_NOTE_NS, 'credit notes cannot be imported as a purchase'],
  ['urn:un:unece:uncefact:data:standard:CrossIndustryCreditNote:100',
    'credit notes cannot be imported as a purchase'],
  ['urn:ferd:CrossIndustryDocument:invoice:1p0',
    'ZUGFeRD 1.0 is not supported — ask the supplier for ZUGFeRD 2.x or Factur-X'],
  ['http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2',
    'FatturaPA is an Italian national format, not a European e-invoice (EN 16931)'],
  ['http://www.facturae.es/Facturae/2009/v3.2/Facturae',
    'Facturae is a Spanish national format, not a European e-invoice (EN 16931)'],
])

/**
 * @param {Buffer} buffer the uploaded file, XML or PDF
 * @returns {Promise<object>} the normalized document
 * @throws {EInvoiceParseError}
 */
export async function parseEInvoice(buffer) {
  if (!buffer?.length) throw new EInvoiceParseError('the file is empty')

  // Sniffed from the bytes, never from the upload's declared content type,
  // which is whatever the browser guessed from the file extension.
  if (isPdf(buffer)) return parseCiiInvoice(await extractFacturXml(buffer))

  const xml = decodeUploadedText(buffer)
  const { namespace } = readRootElement(xml)

  const refusal = REFUSED_ROOTS.get(namespace)
  if (refusal) throw new EInvoiceParseError(refusal)

  if (namespace === UBL_INVOICE_NS) return parseUblInvoice(xml)
  if (namespace === CII_NS) return parseCiiInvoice(xml)

  throw new EInvoiceParseError(
    'not a recognised e-invoice. Supported: UBL 2.1 and UN/CEFACT CII (EN 16931), '
    + 'as .xml or inside a Factur-X / ZUGFeRD 2.x PDF',
  )
}
