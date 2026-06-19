import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import GigTasks from '../components/GigTasks.tsx'
import theme from '../theme.ts'

vi.mock('../api/gigs.ts', () => ({
  createTask: vi.fn().mockImplementation((_gigId, body) =>
    Promise.resolve({ id: 99, gig_id: _gigId, title: body.title, done: false, due_date: body.due_date || null, assigned_to: null })
  ),
  updateTask: vi.fn().mockImplementation((_gigId, taskId, body) =>
    Promise.resolve({ id: taskId, gig_id: _gigId, title: 'Book sound engineer', done: body.done ?? false, due_date: null, assigned_to: body.assigned_to ?? null })
  ),
  deleteTask: vi.fn().mockResolvedValue(null),
}))

import { createTask, deleteTask, updateTask } from '../api/gigs.ts'

const MEMBERS = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
]

const INITIAL_TASKS = [
  { id: 1, gig_id: 42, title: 'Book sound engineer', done: false, due_date: '2026-06-01', assigned_to: null },
  { id: 2, gig_id: 42, title: 'Send invoice', done: true, due_date: null, assigned_to: 1 },
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

    await user.click(screen.getByRole('button', { name: /add task/i }))
    const input = screen.getByPlaceholderText(/task name/i)
    await user.type(input, 'Prepare set list{Enter}')
    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(42, { title: 'Prepare set list', due_date: null, assigned_to: null })
    )
  })

  it('adds a new task via Add button', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)

    await user.click(screen.getByRole('button', { name: /add task/i }))
    const input = screen.getByPlaceholderText(/task name/i)
    await user.type(input, 'Check PA system')
    await user.click(screen.getByRole('button', { name: /add task/i }))
    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(42, { title: 'Check PA system', due_date: null, assigned_to: null })
    )
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

    await user.click(screen.getByRole('button', { name: /delete task book sound engineer/i }))
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith(42, 1))
  })

  it('renders assignment selects with member names when members are provided', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} members={MEMBERS} />)
    // Expand a task row to reveal its edit controls (Collapse is aria-hidden until opened)
    await user.click(screen.getByText('Book sound engineer'))
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('calls updateTask with assigned_to when a member is selected', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} members={MEMBERS} />)

    await user.click(screen.getByText('Book sound engineer'))
    await user.click(screen.getByRole('combobox'))
    const option = await screen.findByRole('option', { name: 'Alice' })
    await user.click(option)
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith(42, 1, { assigned_to: 1 })
    )
  })

  it('does not render assignment selects when no members are provided', () => {
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  })
})

describe('GigTasks — reader mode (canWrite=false)', () => {
  it('hides the add row and delete buttons', () => {
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} canWrite={false} currentBandMemberId={1} />)
    expect(screen.queryByPlaceholderText(/new task/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete task/i })).not.toBeInTheDocument()
  })

  it('disables due-date and assignment edits', () => {
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} members={MEMBERS} canWrite={false} currentBandMemberId={1} />)
    // In reader mode the edit panel (date + assign) is not rendered at all
    expect(screen.queryByLabelText(/due date for/i)).not.toBeInTheDocument()
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  })

  it('lets a reader tick only their own assigned task done', async () => {
    const user = userEvent.setup()
    // INITIAL_TASKS[0] is unassigned (open); INITIAL_TASKS[1] is assigned to member 1 (done).
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} canWrite={false} currentBandMemberId={1} />)
    // The done task is inside the collapsed "Completed" section — expand it first
    await user.click(screen.getByRole('button', { name: /completed/i }))
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[0]).toBeDisabled()   // task 1: unassigned, reader can't toggle
    expect(checkboxes[1]).toBeEnabled()    // task 2: assigned to currentBandMemberId
    await user.click(checkboxes[1])
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(42, 2, { done: false }))
  })
})
