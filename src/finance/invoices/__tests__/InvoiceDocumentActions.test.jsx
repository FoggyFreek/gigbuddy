import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import { CompactLayoutContext } from '../../../hooks/useCompactLayout.ts'
import theme from '../../../theme.ts'
import InvoiceDocumentActions from '../components/InvoiceDocumentActions.tsx'

const baseProps = {
  pdfPath: 'tenants/1/invoices/key.pdf',
  onDownloadUbl: vi.fn(),
  onDownloadUblWithPdf: vi.fn(),
  ublBusy: false,
  peppolBlockers: [],
  canWrite: true,
  onOpenEmailDialog: vi.fn(),
  onRerenderPdf: vi.fn(),
  pdfRerenderBusy: false,
  canDelete: true,
  onDelete: vi.fn(),
  canSave: true,
  onSave: vi.fn(),
  saving: false,
}

function renderActions({ compact = false, ...overrides } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <CompactLayoutContext.Provider value={compact}>
        <InvoiceDocumentActions {...baseProps} {...overrides} />
      </CompactLayoutContext.Provider>
    </ThemeProvider>,
  )
}

describe('InvoiceDocumentActions — wide', () => {
  it('labels every action, with save last and no delete', () => {
    renderActions()
    expect(screen.queryByRole('button', { name: 'Invoice actions' })).toBeNull()
    // Deleting lives at the foot of the page on a wide screen, not in this row.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Download', 'Send', 'Regenerate', 'Save',
    ])
  })

  it('withholds save on a read-only invoice', () => {
    renderActions({ canSave: false })
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('withholds the mutations without finance.manage', () => {
    renderActions({ canWrite: false })
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
  })

  it('offers no regenerate before a PDF exists', () => {
    renderActions({ pdfPath: null })
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
  })
})

describe('InvoiceDocumentActions — compact', () => {
  it('collapses everything into one overflow menu, save first and delete last', async () => {
    renderActions({ compact: true })
    // Nothing is shown inline; it all hides behind the overflow control.
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Invoice actions' }))

    // The download entries are folded in flat rather than nested in a submenu.
    // Save leads and the destructive delete sits last — deliberately not the
    // left-to-right order of the wide row.
    // The compact menu is the only action surface, so it carries deleting too —
    // last, where the wide layout puts it at the foot of the page.
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Save',
      'Download PDF',
      'Download UBL (XML)',
      'UBL with embedded PDF invoice',
      'Send',
      'Regenerate',
      'Delete',
    ])
  })

  it('saves from the overflow menu', async () => {
    const onSave = vi.fn()
    renderActions({ compact: true, onSave })

    await userEvent.click(screen.getByRole('button', { name: 'Invoice actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Save' }))

    expect(onSave).toHaveBeenCalled()
  })

  it('runs the action picked from the overflow menu', async () => {
    const onOpenEmailDialog = vi.fn()
    renderActions({ compact: true, onOpenEmailDialog })

    await userEvent.click(screen.getByRole('button', { name: 'Invoice actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Send' }))

    expect(onOpenEmailDialog).toHaveBeenCalled()
  })

  it('omits the mutations without finance.manage', async () => {
    renderActions({ compact: true, canWrite: false, canDelete: false, canSave: false })

    await userEvent.click(screen.getByRole('button', { name: 'Invoice actions' }))

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Download PDF',
      'Download UBL (XML)',
      'UBL with embedded PDF invoice',
    ])
  })
})
