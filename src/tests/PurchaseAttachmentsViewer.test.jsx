import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'

// jsdom can't run the pdf.js worker; stub react-pdf with inspectable elements.
vi.mock('react-pdf', () => {
  function Document({ file, children, onLoadSuccess }) {
    return (
      <div data-testid="pdf-document" data-file={file}>
        <button type="button" data-testid="pdf-load" onClick={() => onLoadSuccess({ numPages: 3 })}>
          load
        </button>
        {children}
      </div>
    )
  }
  function Page({ pageNumber }) {
    return <div data-testid="pdf-page" data-page={pageNumber} />
  }
  return {
    Document,
    Page,
    pdfjs: { GlobalWorkerOptions: {} },
  }
})

import PurchaseAttachmentsViewer from '../components/purchases/PurchaseAttachmentsViewer.tsx'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const imageAttachment = {
  id: 1,
  object_key: 'tenants/1/purchase_attachments/aaa.png',
  original_filename: 'receipt.png',
  content_type: 'image/png',
  file_size: 1234,
  uploaded_at: '2026-06-11T00:00:00.000Z',
}
const pdfAttachment = {
  id: 2,
  object_key: 'tenants/1/purchase_attachments/bbb.pdf',
  original_filename: 'invoice.pdf',
  content_type: 'application/pdf',
  file_size: 5678,
  uploaded_at: '2026-06-11T01:00:00.000Z',
}

function viewer(props = {}) {
  return (
    <PurchaseAttachmentsViewer
      attachments={[]}
      onUpload={() => {}}
      onDelete={() => {}}
      {...props}
    />
  )
}

describe('PurchaseAttachmentsViewer', () => {
  it('shows the drop target when there are no attachments', () => {
    wrap(viewer())
    expect(screen.getByText(/drag and drop receipts here/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload file/i })).toBeInTheDocument()
  })

  it('calls onUpload with allowed files dropped on the empty target', () => {
    const onUpload = vi.fn()
    wrap(viewer({ onUpload }))

    const pdf = new File(['%PDF-'], 'receipt.pdf', { type: 'application/pdf' })
    const exe = new File(['MZ'], 'evil.exe', { type: 'application/x-msdownload' })
    fireEvent.drop(screen.getByText(/drag and drop receipts here/i).parentElement, {
      dataTransfer: { files: [pdf, exe] },
    })

    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(onUpload.mock.calls[0][0]).toEqual([pdf])
  })

  it('renders an inline image preview with pagination across attachments', async () => {
    const user = userEvent.setup()
    wrap(viewer({ attachments: [imageAttachment, pdfAttachment] }))

    expect(screen.getByAltText('receipt.png')).toHaveAttribute(
      'src',
      '/api/files/tenants/1/purchase_attachments/aaa.png?inline=1',
    )
    expect(screen.getByText('1/2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next attachment/i }))
    expect(screen.getByText('2/2')).toBeInTheDocument()
    expect(screen.getByTestId('pdf-document')).toHaveAttribute(
      'data-file',
      '/api/files/tenants/1/purchase_attachments/bbb.pdf?inline=1',
    )
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '1')
  })

  it('paginates through PDF pages and into the next attachment', async () => {
    const user = userEvent.setup()
    wrap(viewer({ attachments: [pdfAttachment, imageAttachment] }))

    // Simulate the PDF reporting 3 pages → 4 total steps (3 pages + 1 image).
    await user.click(screen.getByTestId('pdf-load'))
    expect(screen.getByText('1/4')).toBeInTheDocument()

    const next = screen.getByRole('button', { name: /next attachment/i })
    await user.click(next)
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '2')
    expect(screen.getByText('2/4')).toBeInTheDocument()

    await user.click(next)
    await user.click(next)
    expect(screen.getByText('4/4')).toBeInTheDocument()
    expect(screen.getByAltText('receipt.png')).toBeInTheDocument()
    expect(next).toBeDisabled()

    // Going back from the image lands on the PDF's last page.
    await user.click(screen.getByRole('button', { name: /previous attachment/i }))
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '3')
  })

  it('zoom controls update the displayed percentage', async () => {
    const user = userEvent.setup()
    wrap(viewer({ attachments: [imageAttachment] }))

    expect(screen.getByText('100%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /zoom in/i }))
    expect(screen.getByText('125%')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /zoom out/i }))
    await user.click(screen.getByRole('button', { name: /zoom out/i }))
    expect(screen.getByText('75%')).toBeInTheDocument()
  })

  it('the image preview is not draggable, so it cannot be dropped back as an upload', () => {
    const onUpload = vi.fn()
    wrap(viewer({ attachments: [imageAttachment], onUpload }))

    const img = screen.getByAltText('receipt.png')
    expect(img).toHaveAttribute('draggable', 'false')
  })

  it('zooming in enlarges the image instead of being clamped by max-width', async () => {
    const user = userEvent.setup()
    wrap(viewer({ attachments: [imageAttachment] }))

    const img = screen.getByAltText('receipt.png')
    // At 100% the image is capped to the viewport.
    expect(getComputedStyle(img).maxWidth).toBe('100%')

    await user.click(screen.getByRole('button', { name: /zoom in/i }))
    // Zoomed in: width grows and the 100% cap must be lifted, or the zoom is a no-op.
    expect(getComputedStyle(img).width).toBe('125%')
    expect(getComputedStyle(img).maxWidth).not.toBe('100%')
  })

  it('dots menu offers add, download and delete; delete reports the current attachment', async () => {
    const onDelete = vi.fn()
    const user = userEvent.setup()
    wrap(viewer({ attachments: [imageAttachment, pdfAttachment], onDelete }))

    await user.click(screen.getByRole('button', { name: /next attachment/i }))
    await user.click(screen.getByRole('button', { name: /attachment options/i }))

    expect(screen.getByRole('menuitem', { name: /add attachment/i })).toBeInTheDocument()
    const download = screen.getByRole('menuitem', { name: /download/i })
    expect(download).toHaveAttribute('href', '/api/files/tenants/1/purchase_attachments/bbb.pdf')

    await user.click(screen.getByRole('menuitem', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledWith(2)
  })

})
