import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { describe, expect, it, vi } from 'vitest'
import GigTasks from '../components/gigdetails/GigTasks.tsx'
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
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
    </ThemeProvider>,
  )
}

describe('GigTasks', () => {
  it('renders existing tasks from initialTasks', () => {
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)
    expect(screen.getByText('Book sound engineer')).toBeInTheDocument()
    expect(screen.getByText('Send invoice')).toBeInTheDocument()
  })

  it('shows the due date on the task card', () => {
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)
    expect(screen.getByRole('button', { name: /due date for Book sound engineer/i })).toHaveTextContent('Jun 1')
  })

  it('shows the assignee name on the task card', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} members={MEMBERS} />)
    await user.click(screen.getByRole('button', { name: /completed/i }))
    expect(screen.getByRole('button', { name: /assign Send invoice/i })).toHaveTextContent('Alice')
  })

  it('updates the due date from the calendar', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)

    await user.click(screen.getByRole('button', { name: /due date for Book sound engineer/i }))
    await user.click(await screen.findByRole('gridcell', { name: '15' }))
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith(42, 1, { due_date: '2026-06-15' })
    )
  })

  it('clears the due date from the calendar popover', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)

    await user.click(screen.getByRole('button', { name: /due date for Book sound engineer/i }))
    await user.click(await screen.findByRole('button', { name: /clear due date/i }))
    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(42, 1, { due_date: null }))
  })

  it('adds a new task on Enter key', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)

    await user.type(screen.getByPlaceholderText(/add task/i), 'Prepare set list{Enter}')
    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(42, { title: 'Prepare set list', due_date: null, assigned_to: null })
    )
  })

  it('adds a new task via the Add button', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)

    await user.type(screen.getByPlaceholderText(/add task/i), 'Check PA system')
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

  it('calls updateTask with assigned_to when a member is picked', async () => {
    const user = userEvent.setup()
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} members={MEMBERS} />)

    await user.click(screen.getByRole('button', { name: /assign Book sound engineer/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Alice' }))
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith(42, 1, { assigned_to: 1 })
    )
  })

  it('does not offer assignment when no members are provided', () => {
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} />)
    expect(screen.queryByRole('button', { name: /assign/i })).not.toBeInTheDocument()
  })
})

describe('GigTasks — reader mode (canWrite=false)', () => {
  it('hides the composer and the delete buttons', () => {
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} canWrite={false} currentBandMemberId={1} />)
    expect(screen.queryByPlaceholderText(/add task/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete task/i })).not.toBeInTheDocument()
  })

  it('shows due date and assignee as static text, not editable controls', () => {
    wrap(<GigTasks gigId={42} initialTasks={INITIAL_TASKS} members={MEMBERS} canWrite={false} currentBandMemberId={1} />)
    expect(screen.getByText('Jun 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /due date for/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /assign/i })).not.toBeInTheDocument()
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
