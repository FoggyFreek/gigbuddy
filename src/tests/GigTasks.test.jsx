import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import GigTasks from '../components/GigTasks.jsx'
import theme from '../theme.js'

vi.mock('../api/gigs.js', () => ({
  createTask: vi.fn().mockImplementation((_gigId, body) =>
    Promise.resolve({ id: 99, gig_id: _gigId, title: body.title, done: false, due_date: body.due_date || null })
  ),
  updateTask: vi.fn().mockImplementation((_gigId, taskId, body) =>
    Promise.resolve({ id: taskId, gig_id: _gigId, title: 'Book sound engineer', done: body.done ?? false, due_date: null })
  ),
  deleteTask: vi.fn().mockResolvedValue(null),
}))

import { createTask, deleteTask, updateTask } from '../api/gigs.js'

const INITIAL_TASKS = [
  { id: 1, gig_id: 42, title: 'Book sound engineer', done: false, due_date: '2026-06-01' },
  { id: 2, gig_id: 42, title: 'Send invoice', done: true, due_date: null },
]

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('GigTasks', () => {
  it('renders existing tasks from initialTasks', () => {
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)
    expect(screen.getByText('Book sound engineer')).toBeInTheDocument()
    expect(screen.getByText('Send invoice')).toBeInTheDocument()
  })

  it('renders due date input populated for task with due date', () => {
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)
    const input = screen.getByLabelText(/Due date for Book sound engineer/i)
    expect(input).toHaveValue('2026-06-01')
  })

  it('updates due date on change', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)

    const input = screen.getByLabelText(/Due date for Send invoice/i)
    await user.type(input, '2026-07-15')
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith(42, 2, { due_date: '2026-07-15' })
    )
  })

  it('adds a new task on Enter key', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)

    const input = screen.getByPlaceholderText(/new task/i)
    await user.type(input, 'Prepare set list{Enter}')
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(42, { title: 'Prepare set list', due_date: null }))
  })

  it('adds a new task via Add button', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)

    const input = screen.getByPlaceholderText(/new task/i)
    await user.type(input, 'Check PA system')
    const addBtn = screen.getAllByRole('button').find(
      (b) => b.querySelector('[data-testid="AddIcon"]')
    )
    await user.click(addBtn)
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(42, { title: 'Check PA system', due_date: null }))
  })

  it('toggles task done state on checkbox click', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(42, 1, { done: true }))
  })

  it('deletes a task on delete button click', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)

    const allButtons = screen.getAllByRole('button')
    const taskDeleteBtns = allButtons.slice(-2)
    await user.click(taskDeleteBtns[0])
    await waitFor(() => expect(deleteTask).toHaveBeenCalled())
  })
})
