import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/purchases.ts', () => ({
  importPurchaseDocument: vi.fn(),
}))

import { importPurchaseDocument } from '../api/purchases.ts'
import ImportPurchaseDialog from '../components/purchases/ImportPurchaseDialog.tsx'
import i18n from '../i18n/index.ts'
import theme from '../theme.ts'

const RESULT = {
  purchase: {
    id: 77,
    supplier_name: 'Recording Studio De Kerk',
    total_cents: 119790,
    lines: [{ description: 'Opnamedag' }, { description: 'Mixen' }],
  },
  warnings: [],
}

const wrap = (ui) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)

const xmlFile = () => new File(['<Invoice/>'], 'factuur.xml', { type: 'text/xml' })

// The file input is `hidden` inside a MUI Button label, so it is reached by
// element rather than by role.
const fileInput = () => document.querySelector('input[type="file"]')

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  importPurchaseDocument.mockResolvedValue(RESULT)
})

describe('ImportPurchaseDialog', () => {
  it('uploads the chosen file and summarises the draft it created', async () => {
    const user = userEvent.setup()
    wrap(<ImportPurchaseDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await user.upload(fileInput(), xmlFile())

    await waitFor(() => expect(importPurchaseDocument).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Draft purchase created')).toBeInTheDocument()
    expect(screen.getByText(/Recording Studio De Kerk/)).toHaveTextContent('€ 1.197,90')
  })

  it('hands the new purchase id back when the draft is opened', async () => {
    const user = userEvent.setup()
    const onImported = vi.fn()
    wrap(<ImportPurchaseDialog onClose={vi.fn()} onImported={onImported} />)

    await user.upload(fileInput(), xmlFile())
    await user.click(await screen.findByRole('button', { name: 'Open draft' }))

    expect(onImported).toHaveBeenCalledWith(77)
  })

  it('separates what must be checked before approving from what was merely inferred', async () => {
    importPurchaseDocument.mockResolvedValue({
      ...RESULT,
      warnings: [
        { code: 'possible_duplicate', severity: 'blocking', receiptNumbers: [12] },
        { code: 'document_discount_allocated', severity: 'advisory' },
      ],
    })
    const user = userEvent.setup()
    wrap(<ImportPurchaseDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await user.upload(fileInput(), xmlFile())

    expect(await screen.findByText('Check before approving')).toBeInTheDocument()
    expect(screen.getByText(/already exists \(#12\)/)).toBeInTheDocument()
    expect(screen.getByText('What was inferred')).toBeInTheDocument()
    expect(screen.getByText(/discount was spread across the lines/)).toBeInTheDocument()
  })

  it('interpolates the amounts a warning carries', async () => {
    importPurchaseDocument.mockResolvedValue({
      ...RESULT,
      warnings: [{ code: 'totals_mismatch', severity: 'blocking', cents: -7900, statedCents: 20000 }],
    })
    const user = userEvent.setup()
    wrap(<ImportPurchaseDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await user.upload(fileInput(), xmlFile())

    // The gap is reported as a magnitude; its direction is not implied.
    expect(await screen.findByText(/off by € 79,00/)).toBeInTheDocument()
    expect(screen.getByText(/€ 200,00/)).toBeInTheDocument()
  })

  it('shows the upload step again when the file is rejected', async () => {
    importPurchaseDocument.mockRejectedValue(new Error('Only EUR invoices can be imported'))
    const user = userEvent.setup()
    wrap(<ImportPurchaseDialog onClose={vi.fn()} onImported={vi.fn()} />)

    await user.upload(fileInput(), xmlFile())

    expect(await screen.findByText('Only EUR invoices can be imported')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeInTheDocument()
  })
})
