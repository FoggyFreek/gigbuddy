import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/tasks.ts', () => ({
  listAllTasks: vi.fn(),
}))
vi.mock('../api/gigs.ts', () => ({
  updateTask: vi.fn(),
}))
vi.mock('../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
}))
vi.mock('../components/GigFormModal.tsx', () => ({
  default: () => null,
}))

import TasksPage from '../pages/TasksPage.tsx'
import { listAllTasks } from '../api/tasks.ts'
import { useAuth } from '../contexts/authContext.ts'
import theme from '../theme.ts'

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>
  )
}

const TASKS = [
  {
    id: 10,
    gig_id: 1,
    title: 'Send invoice',
    done: false,
    due_date: null,
    created_at: '2026-04-01T00:00:00.000Z',
    event_description: 'Jazz Night',
    event_date: '2026-06-15T00:00:00.000Z',
    assigned_to: 1,
    assigned_to_name: 'Alice',
  },
  {
    id: 11,
    gig_id: 2,
    title: 'Confirm rider',
    done: false,
    due_date: null,
    created_at: '2026-04-02T00:00:00.000Z',
    event_description: 'Summer Festival',
    event_date: '2026-07-01T00:00:00.000Z',
    assigned_to: 2,
    assigned_to_name: 'Bob',
  },
  {
    id: 12,
    gig_id: 3,
    title: 'Book hotel',
    done: true,
    due_date: null,
    created_at: '2026-04-03T00:00:00.000Z',
    event_description: 'Winter Tour',
    event_date: '2026-12-01T00:00:00.000Z',
    assigned_to: 1,
    assigned_to_name: 'Alice',
  },
]

describe('TasksPage', () => {
  beforeEach(() => {
    listAllTasks.mockResolvedValue(TASKS)
    useAuth.mockReturnValue({ user: { id: 1, bandMemberId: 1 } })
  })

  it('shows all tasks on load', async () => {
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    expect(screen.getByText('Confirm rider')).toBeInTheDocument()
  })

  it('shows "My tasks" toggle when user has a bandMemberId', async () => {
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /assigned to me/i })).toBeInTheDocument()
  })

  it('hides "My tasks" toggle when user has no bandMemberId', async () => {
    useAuth.mockReturnValue({ user: { id: 1, bandMemberId: null } })
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /assigned to me/i })).not.toBeInTheDocument()
  })

  it('filters to only the current user\'s tasks when "My tasks" is toggled on', async () => {
    const user = userEvent.setup()
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /assigned to me/i }))
    expect(screen.getByText('Send invoice')).toBeInTheDocument()
    expect(screen.queryByText('Confirm rider')).not.toBeInTheDocument()
  })

  it('shows all tasks again when "My tasks" is toggled off', async () => {
    const user = userEvent.setup()
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())

    const toggle = screen.getByRole('button', { name: /assigned to me/i })
    await user.click(toggle)
    await user.click(toggle)
    expect(screen.getByText('Send invoice')).toBeInTheDocument()
    expect(screen.getByText('Confirm rider')).toBeInTheDocument()
  })

  it('hides finished tasks by default', async () => {
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    expect(screen.queryByText('Book hotel')).not.toBeInTheDocument()
  })

  it('shows finished tasks when "Show finished" is toggled on', async () => {
    const user = userEvent.setup()
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /finished/i }))
    expect(screen.getByText('Book hotel')).toBeInTheDocument()
  })

  it('hides finished tasks again when "Show finished" is toggled off', async () => {
    const user = userEvent.setup()
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())

    const toggle = screen.getByRole('button', { name: /finished/i })
    await user.click(toggle)
    expect(screen.getByText('Book hotel')).toBeInTheDocument()

    await user.click(toggle)
    expect(screen.queryByText('Book hotel')).not.toBeInTheDocument()
  })
})
