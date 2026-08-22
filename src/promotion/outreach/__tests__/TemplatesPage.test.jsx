import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogProvider } from '../../../contexts/DialogContext.tsx'
import theme from '../../../theme.ts'
import TemplatesPage from '../TemplatesPage.tsx'
import { copyOutreachTemplate, deleteOutreachTemplate, listOutreachTemplates } from '../outreachTemplates.ts'

vi.mock('../outreachTemplates.ts', () => ({
  copyOutreachTemplate: vi.fn(),
  deleteOutreachTemplate: vi.fn(),
  listOutreachTemplates: vi.fn(),
}))

vi.mock('../../../hooks/usePermissions.ts', () => ({
  usePermissions: () => ({ canWritePlanning: true, canManageFinance: true }),
}))

const TEMPLATE = {
  id: 1,
  name: 'Test1',
  subject: 'This subject must not be shown',
  preview_text: null,
  body_json: {},
  body_html: '',
  body_text: '',
  origin_key: null,
  locale: 'en',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DialogProvider>
        <ThemeProvider theme={theme}>
          <TemplatesPage />
        </ThemeProvider>
      </DialogProvider>
    </MemoryRouter>,
  )
}

describe('TemplatesPage', () => {
  beforeEach(() => {
    listOutreachTemplates.mockReset().mockResolvedValue({ items: [TEMPLATE], meta: { limit: 100, returned: 1 } })
    copyOutreachTemplate.mockReset().mockResolvedValue({ ...TEMPLATE, id: 2, name: 'Test1 Copy' })
    deleteOutreachTemplate.mockReset().mockResolvedValue(undefined)
  })

  it('shows only email template name and language data columns', async () => {
    renderPage()

    expect(await screen.findByText('Test1')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Language' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Context' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Subject' })).not.toBeInTheDocument()
    expect(screen.queryByText('This subject must not be shown')).not.toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Contract' })).not.toBeInTheDocument()
  })

  it('copies only after DialogContext confirmation and adds the returned row', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Test1')

    await user.click(screen.getByRole('button', { name: 'Copy template' }))
    expect(copyOutreachTemplate).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Copy "Test1"?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(copyOutreachTemplate).toHaveBeenCalledWith(1))
    expect(await screen.findByText('Test1 Copy')).toBeInTheDocument()
  })

  it('deletes only after the shared delete confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Test1')

    await user.click(screen.getByRole('button', { name: 'Delete template' }))
    expect(deleteOutreachTemplate).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete "Test1"?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteOutreachTemplate).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.queryByText('Test1')).not.toBeInTheDocument())
  })
})
