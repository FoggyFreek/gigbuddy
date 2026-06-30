import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/tasks.ts', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}))
vi.mock('../api/bandMembers.ts', () => ({
  listMembers: vi.fn(() => Promise.resolve([{ id: 1, name: 'Alice' }])),
}))

import TaskFormDialog from '../components/TaskFormDialog.tsx'
import { createTask, updateTask, deleteTask } from '../api/tasks.ts'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const EDIT_TASK = {
  id: 10, title: 'Send invoice', done: false, due_date: '2026-08-01',
  assigned_to: null, gig_id: 1, event_description: 'Jazz Night',
}

describe('TaskFormDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createTask.mockResolvedValue({ id: 99 })
    updateTask.mockResolvedValue({})
    deleteTask.mockResolvedValue(undefined)
  })

  it('creates a standalone task and never sends a gig_id', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const onClose = vi.fn()
    wrap(<TaskFormDialog open task={null} onClose={onClose} onSaved={onSaved} />)
    await user.type(screen.getByLabelText(/title/i), 'New chore')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    const [body] = createTask.mock.calls[0]
    expect(body).toMatchObject({ title: 'New chore', assigned_to: null })
    expect(body).not.toHaveProperty('gig_id')
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not offer a gig field in create mode', () => {
    wrap(<TaskFormDialog open task={null} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.queryByLabelText(/linked gig/i)).not.toBeInTheDocument()
  })

  it('uses the theme-responsive date picker control', () => {
    wrap(<TaskFormDialog open task={null} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'open date picker' })).toBeInTheDocument()
  })

  it('edits an existing task and does not send gig_id', async () => {
    const user = userEvent.setup()
    wrap(<TaskFormDialog open task={EDIT_TASK} onClose={vi.fn()} onSaved={vi.fn()} />)
    const titleField = screen.getByLabelText(/title/i)
    expect(titleField).toHaveValue('Send invoice')
    await user.clear(titleField)
    await user.type(titleField, 'Send the invoice')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1))
    const [id, body] = updateTask.mock.calls[0]
    expect(id).toBe(10)
    expect(body.title).toBe('Send the invoice')
    expect(body).not.toHaveProperty('gig_id')
  })

  it('shows the linked gig as a disabled, read-only field when editing a linked task', () => {
    wrap(<TaskFormDialog open task={EDIT_TASK} onClose={vi.fn()} onSaved={vi.fn()} />)
    const gigField = screen.getByLabelText(/linked gig/i)
    expect(gigField).toBeDisabled()
    expect(gigField).toHaveValue('Jazz Night')
  })

  it('shows no gig field when editing a standalone task', () => {
    const standalone = { ...EDIT_TASK, gig_id: null, event_description: null }
    wrap(<TaskFormDialog open task={standalone} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.queryByLabelText(/linked gig/i)).not.toBeInTheDocument()
  })

  it('deletes a task from edit mode', async () => {
    const user = userEvent.setup()
    const onDeleted = vi.fn()
    const onClose = vi.fn()
    wrap(<TaskFormDialog open task={EDIT_TASK} onClose={onClose} onSaved={vi.fn()} onDeleted={onDeleted} />)
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith(10))
    expect(onDeleted).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
