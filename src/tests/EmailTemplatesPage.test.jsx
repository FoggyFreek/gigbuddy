import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(() => ({
    getHTML: vi.fn().mockReturnValue(''),
    commands: { setContent: vi.fn() },
    isActive: vi.fn().mockReturnValue(false),
    getAttributes: vi.fn().mockReturnValue({}),
    chain: vi.fn(() => ({ focus: vi.fn(() => ({ run: vi.fn() })) })),
  })),
  EditorContent: () => <div data-testid="tiptap-editor" />,
}))
vi.mock('@tiptap/starter-kit', () => ({ default: {} }))
vi.mock('@tiptap/extension-link', () => ({ default: { configure: vi.fn().mockReturnValue({}) } }))
vi.mock('@tiptap/extension-underline', () => ({ default: {} }))

vi.mock('../api/emailTemplates.js', () => ({
  listEmailTemplates: vi.fn(),
  getEmailTemplate: vi.fn().mockResolvedValue({
    id: 1,
    name: 'Gig Announcement',
    subject: "We're playing Friday!",
    body_html: '<p>Come see us live!</p>',
  }),
  createEmailTemplate: vi.fn().mockResolvedValue({ id: 99 }),
  updateEmailTemplate: vi.fn().mockResolvedValue({}),
  deleteEmailTemplate: vi.fn().mockResolvedValue({}),
}))

import EmailTemplatesPage from '../pages/EmailTemplatesPage.jsx'
import { listEmailTemplates, deleteEmailTemplate } from '../api/emailTemplates.js'
import theme from '../theme.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const TEMPLATES = [
  { id: 1, name: 'Gig Announcement', subject: "We're playing Friday!", created_at: '2099-06-01T10:00:00Z' },
  { id: 2, name: 'Rehearsal Notice', subject: 'Practice this Thursday', created_at: '2099-06-02T10:00:00Z' },
]

describe('EmailTemplatesPage', () => {
  beforeEach(() => {
    listEmailTemplates.mockReset()
    listEmailTemplates.mockResolvedValue(TEMPLATES)
    deleteEmailTemplate.mockClear()
  })

  it('renders the page heading and New template button', async () => {
    wrap(<EmailTemplatesPage />)
    expect(screen.getByRole('heading', { name: /email templates/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new template/i })).toBeInTheDocument()
    await waitFor(() => expect(listEmailTemplates).toHaveBeenCalled())
  })

  it('shows loaded templates in the table', async () => {
    wrap(<EmailTemplatesPage />)
    await waitFor(() => expect(screen.getByText('Gig Announcement')).toBeInTheDocument())
    expect(screen.getByText('Rehearsal Notice')).toBeInTheDocument()
    expect(screen.getByText("We're playing Friday!")).toBeInTheDocument()
  })

  it('shows empty state when no templates exist', async () => {
    listEmailTemplates.mockResolvedValue([])
    wrap(<EmailTemplatesPage />)
    await waitFor(() => expect(screen.getByText(/no templates yet/i)).toBeInTheDocument())
  })

  it('opens the create modal when New template is clicked', async () => {
    const user = userEvent.setup()
    wrap(<EmailTemplatesPage />)
    await waitFor(() => expect(listEmailTemplates).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /new template/i }))
    expect(screen.getByText('New email template', { selector: 'h2' })).toBeInTheDocument()
  })

  it('opens the edit modal when a table row is clicked', async () => {
    const user = userEvent.setup()
    wrap(<EmailTemplatesPage />)
    await waitFor(() => screen.getByText('Gig Announcement'))
    await user.click(screen.getByText('Gig Announcement'))
    await waitFor(() =>
      expect(screen.getByText('Edit email template', { selector: 'h2' })).toBeInTheDocument()
    )
  })

  it('shows delete confirmation dialog when delete button is clicked', async () => {
    const user = userEvent.setup()
    wrap(<EmailTemplatesPage />)
    await waitFor(() => screen.getByText('Gig Announcement'))

    const deleteButtons = screen.getAllByRole('button', { name: /delete template/i })
    await user.click(deleteButtons[0])

    expect(screen.getByText(/delete template\?/i)).toBeInTheDocument()
    // confirm dialog shows Cancel and Delete buttons
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /cancel/i }).length).toBeGreaterThanOrEqual(1)
  })

  it('calls deleteEmailTemplate and reloads when delete is confirmed', async () => {
    const user = userEvent.setup()
    wrap(<EmailTemplatesPage />)
    await waitFor(() => expect(listEmailTemplates).toHaveBeenCalledTimes(1))
    await waitFor(() => screen.getByText('Gig Announcement'))

    const deleteButtons = screen.getAllByRole('button', { name: /delete template/i })
    await user.click(deleteButtons[0])

    const confirmButton = screen.getByRole('button', { name: /^delete$/i })
    await user.click(confirmButton)

    await waitFor(() => expect(deleteEmailTemplate).toHaveBeenCalledWith(1))
    await waitFor(() => expect(listEmailTemplates).toHaveBeenCalledTimes(2))
  })

  it('does not call deleteEmailTemplate when cancel is clicked in the dialog', async () => {
    const user = userEvent.setup()
    wrap(<EmailTemplatesPage />)
    await waitFor(() => screen.getByText('Gig Announcement'))

    const deleteButtons = screen.getAllByRole('button', { name: /delete template/i })
    await user.click(deleteButtons[0])

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(deleteEmailTemplate).not.toHaveBeenCalled()
    expect(listEmailTemplates).toHaveBeenCalledTimes(1)
  })
})
