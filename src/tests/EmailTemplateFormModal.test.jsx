import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted lets the mock editor be referenced inside the factory (which is hoisted before imports)
const mockEditor = vi.hoisted(() => ({
  getHTML: vi.fn().mockReturnValue('<p>Hello world</p>'),
  commands: { setContent: vi.fn() },
  isActive: vi.fn().mockReturnValue(false),
  getAttributes: vi.fn().mockReturnValue({}),
  chain: vi.fn(() => ({ focus: vi.fn(() => ({ run: vi.fn() })) })),
}))

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(() => mockEditor),
  EditorContent: () => <div data-testid="tiptap-editor" />,
}))
vi.mock('@tiptap/starter-kit', () => ({ default: { configure: vi.fn().mockReturnValue({}) } }))
vi.mock('@tiptap/extension-link', () => ({ default: { configure: vi.fn().mockReturnValue({}) } }))
vi.mock('@tiptap/extension-underline', () => ({ default: {} }))

vi.mock('../api/emailTemplates.js', () => ({
  createEmailTemplate: vi.fn().mockResolvedValue({ id: 99 }),
  getEmailTemplate: vi.fn().mockResolvedValue({
    id: 1,
    name: 'Gig Announcement',
    subject: "We're playing Friday!",
    body_html: '<p>Come see us live!</p>',
  }),
  updateEmailTemplate: vi.fn().mockResolvedValue({}),
}))

import EmailTemplateFormModal from '../components/EmailTemplateFormModal.jsx'
import { createEmailTemplate, getEmailTemplate, updateEmailTemplate } from '../api/emailTemplates.js'
import theme from '../theme.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('EmailTemplateFormModal — create mode', () => {
  beforeEach(() => {
    createEmailTemplate.mockClear()
  })

  it('renders the new template dialog title', () => {
    wrap(<EmailTemplateFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByText('New email template')).toBeInTheDocument()
  })

  it('shows Cancel and Save template buttons', () => {
    wrap(<EmailTemplateFormModal mode="create" onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save template/i })).toBeInTheDocument()
  })

  it('shows a validation error when name is empty on submit', async () => {
    const user = userEvent.setup()
    wrap(<EmailTemplateFormModal mode="create" onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: /save template/i }))
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(createEmailTemplate).not.toHaveBeenCalled()
  })

  it('calls createEmailTemplate with name, subject, and editor HTML then closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<EmailTemplateFormModal mode="create" onClose={onClose} />)

    await user.type(screen.getByLabelText(/template name/i), 'Gig Announcement')
    await user.type(screen.getByLabelText(/subject/i), "We're playing Friday!")
    await user.click(screen.getByRole('button', { name: /save template/i }))

    await waitFor(() =>
      expect(createEmailTemplate).toHaveBeenCalledWith({
        name: 'Gig Announcement',
        subject: "We're playing Friday!",
        body_html: '<p>Hello world</p>',
      })
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('calls onClose immediately when Cancel is clicked without calling the API', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<EmailTemplateFormModal mode="create" onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(createEmailTemplate).not.toHaveBeenCalled()
  })
})

describe('EmailTemplateFormModal — edit mode', () => {
  beforeEach(() => {
    getEmailTemplate.mockClear()
    updateEmailTemplate.mockClear()
    mockEditor.commands.setContent.mockClear()
  })

  it('loads template data and populates name and subject fields', async () => {
    wrap(<EmailTemplateFormModal mode="edit" templateId={1} onClose={() => {}} />)
    await waitFor(() => expect(getEmailTemplate).toHaveBeenCalledWith(1))
    await waitFor(() =>
      expect(screen.getByDisplayValue('Gig Announcement')).toBeInTheDocument()
    )
    expect(screen.getByDisplayValue("We're playing Friday!")).toBeInTheDocument()
  })

  it('populates the editor with the saved body HTML', async () => {
    wrap(<EmailTemplateFormModal mode="edit" templateId={1} onClose={() => {}} />)
    await waitFor(() => expect(getEmailTemplate).toHaveBeenCalledWith(1))
    await waitFor(() =>
      expect(mockEditor.commands.setContent).toHaveBeenCalledWith('<p>Come see us live!</p>')
    )
  })

  it('shows Close and Download .eml buttons (not Save template) in edit mode', async () => {
    wrap(<EmailTemplateFormModal mode="edit" templateId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByRole('button', { name: /close/i }))
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download .eml/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save template/i })).not.toBeInTheDocument()
  })

  it('auto-saves when the subject field is edited', async () => {
    const user = userEvent.setup()
    wrap(<EmailTemplateFormModal mode="edit" templateId={1} onClose={() => {}} />)
    await waitFor(() => screen.getByDisplayValue("We're playing Friday!"))

    const subjectInput = screen.getByDisplayValue("We're playing Friday!")
    await user.clear(subjectInput)
    await user.type(subjectInput, 'Updated subject')

    await waitFor(
      () =>
        expect(updateEmailTemplate).toHaveBeenCalledWith(
          1,
          { subject: 'Updated subject' }
        ),
      { timeout: 2000 }
    )
  })

  it('flushes pending saves and calls onClose when Close is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<EmailTemplateFormModal mode="edit" templateId={1} onClose={onClose} />)
    await waitFor(() => screen.getByDisplayValue('Gig Announcement'))

    await user.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  describe('Download .eml', () => {
    it('generates a Blob with valid MIME-822 structure and triggers download', async () => {
      const user = userEvent.setup()
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
      const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

      wrap(<EmailTemplateFormModal mode="edit" templateId={1} onClose={() => {}} />)
      await waitFor(() => screen.getByRole('button', { name: /download .eml/i }))

      await user.click(screen.getByRole('button', { name: /download .eml/i }))

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      const blob = createObjectURL.mock.calls[0][0]
      expect(blob).toBeInstanceOf(Blob)
      expect(blob.type).toBe('message/rfc822')

      const text = await blob.text()
      expect(text).toContain('MIME-Version: 1.0')
      expect(text).toContain('Content-Type: text/html; charset=utf-8')
      expect(text).toContain("Subject: We're playing Friday!")
      // body comes from the mocked editor's getHTML()
      expect(text).toContain('<p>Hello world</p>')

      expect(clickSpy).toHaveBeenCalled()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')

      clickSpy.mockRestore()
      createObjectURL.mockRestore()
      revokeObjectURL.mockRestore()
    })

    it('uses the template name (underscored) as the download filename', async () => {
      const user = userEvent.setup()
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

      let capturedAnchor
      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        const el = document.createElementNS('http://www.w3.org/1999/xhtml', tag)
        if (tag === 'a') {
          capturedAnchor = el
          vi.spyOn(el, 'click').mockImplementation(() => {})
        }
        return el
      })

      wrap(<EmailTemplateFormModal mode="edit" templateId={1} onClose={() => {}} />)
      await waitFor(() => screen.getByRole('button', { name: /download .eml/i }))

      await user.click(screen.getByRole('button', { name: /download .eml/i }))

      expect(capturedAnchor?.download).toBe('Gig_Announcement.eml')

      createElementSpy.mockRestore()
      URL.createObjectURL.mockRestore()
      URL.revokeObjectURL.mockRestore()
    })
  })
})
