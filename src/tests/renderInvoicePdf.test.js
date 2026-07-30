// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { renderInvoicePdf } from '../../server/utils/renderInvoicePdf.js'
import { CASES } from './fixtures/ubl/cases.js'

async function pdfText(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise
  const page = await pdf.getPage(1)
  const content = await page.getTextContent()
  return content.items.map((item) => item.str).join(' ')
}

describe('renderInvoicePdf', () => {
  it('includes the customer business identifiers with Dutch invoice labels', async () => {
    const data = CASES['nl-standard']
    const buffer = await renderInvoicePdf({ ...data, logoBuffer: null })
    const text = await pdfText(buffer)

    expect(text).toContain('KVK nr.: 87654321')
    expect(text).toContain('BTW nr.: NL819789471B01')
  })

  it('uses the English Chamber of Commerce label on an English invoice', async () => {
    const data = CASES['de-domestic']
    const buffer = await renderInvoicePdf({
      ...data,
      invoice: {
        ...data.invoice,
        customer_kvk: '87654321',
        customer_tax_id: 'DE136695976',
      },
      logoBuffer: null,
    })
    const text = await pdfText(buffer)

    expect(text).toContain('Chamber of Commerce number: 87654321')
    expect(text).toContain('VAT ID: DE136695976')
  })
})
