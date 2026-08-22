import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import theme from '../../../theme.ts'
import InvoiceDownloadMenu from '../components/InvoiceDownloadMenu.tsx'

const baseProps = {
  pdfPath: null,
  onDownloadUbl: vi.fn(),
  onDownloadUblWithPdf: vi.fn(),
  ublBusy: false,
  peppolBlockers: [],
}

function renderMenu(overrides = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <InvoiceDownloadMenu {...baseProps} {...overrides} />
    </ThemeProvider>,
  )
}

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: 'Download' }))
}

describe('InvoiceDownloadMenu', () => {
  it('offers XML variants before a PDF exists, then includes the saved PDF', async () => {
    const { rerender } = renderMenu()
    await openMenu()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Download UBL (XML)',
      'UBL with embedded PDF invoice',
    ])

    rerender(
      <ThemeProvider theme={theme}>
        <InvoiceDownloadMenu {...baseProps} pdfPath="tenants/1/invoices/old-key.pdf" />
      </ThemeProvider>,
    )
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Download PDF',
      'Download UBL (XML)',
      'UBL with embedded PDF invoice',
    ])
    expect(screen.getByRole('menuitem', { name: 'Download PDF' }))
      .toHaveAttribute('href', '/api/files/tenants/1/invoices/old-key.pdf')
  })

  it('annotates a UBL that Peppol would reject, but never blocks downloading it', async () => {
    renderMenu({
      peppolBlockers: [{ code: 'unknown_buyer_country', severity: 'blocking' }],
    })
    await openMenu()

    const hint = screen.getByLabelText(/Not ready for e-invoicing/)
    expect(hint.getAttribute('aria-label')).toContain('country could not be recognised')
    expect(screen.getByRole('menuitem', { name: /Not ready for e-invoicing/ })).toBeEnabled()
  })

  it('dispatches each UBL variant and closes the menu', async () => {
    const onDownloadUbl = vi.fn()
    const onDownloadUblWithPdf = vi.fn()
    renderMenu({ onDownloadUbl, onDownloadUblWithPdf })

    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Download UBL (XML)' }))
    expect(onDownloadUbl).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menuitem')).toBeNull()

    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'UBL with embedded PDF invoice' }))
    expect(onDownloadUblWithPdf).toHaveBeenCalledTimes(1)
  })
})
