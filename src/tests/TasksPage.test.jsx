import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/tasks.ts', () => ({
  listAllTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}))
vi.mock('../api/bandMembers.ts', () => ({
  listMembers: vi.fn(() => Promise.resolve([])),
}))
vi.mock('../contexts/authContext.ts', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/usePermissions.ts', () => ({ usePermissions: vi.fn() }))

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}))

import TasksPage from '../pages/TasksPage.tsx'
import { listAllTasks, createTask, updateTask, deleteTask } from '../api/tasks.ts'
import { useAuth } from '../contexts/authContext.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { CompactLayoutContext } from '../hooks/useCompactLayout.ts'
import theme from '../theme.ts'

function wrap(ui, { compact = false } = {}) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <CompactLayoutContext.Provider value={compact}>
          {ui}
        </CompactLayoutContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

const TASKS = [
  {
    id: 10, gig_id: 1, title: 'Send invoice', done: false, due_date: null,
    event_description: 'Jazz Night', event_date: '2026-06-15T00:00:00.000Z',
    assigned_to: 1, assigned_to_name: 'Alice',
  },
  {
    id: 11, gig_id: 2, title: 'Confirm rider', done: false, due_date: null,
    event_description: 'Summer Festival', event_date: '2026-07-01T00:00:00.000Z',
    assigned_to: 2, assigned_to_name: 'Bob',
  },
  {
    id: 12, gig_id: null, title: 'Buy strings', done: false, due_date: null,
    event_description: null, event_date: null, assigned_to: 1, assigned_to_name: 'Alice',
  },
]

describe('TasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listAllTasks.mockResolvedValue(TASKS)
    createTask.mockResolvedValue({ id: 99 })
    updateTask.mockResolvedValue({})
    deleteTask.mockResolvedValue(undefined)
    useAuth.mockReturnValue({ user: { id: 1, bandMemberId: 1 } })
    usePermissions.mockReturnValue({ canWritePlanning: true })
  })

  it('shows all tasks on load', async () => {
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    expect(screen.getByText('Confirm rider')).toBeInTheDocument()
    expect(screen.getByText('Buy strings')).toBeInTheDocument()
  })

  it('keeps a finished gig task visible and disabled while that gig has open tasks', async () => {
    listAllTasks.mockResolvedValue([
      { ...TASKS[0], id: 20, title: 'Finished setup', done: true },
      { ...TASKS[0], id: 21, title: 'Open setup', done: false },
    ])

    wrap(<TasksPage />)

    await waitFor(() => expect(screen.getByText('Open setup')).toBeInTheDocument())
    expect(screen.getByText('Finished setup')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')[0]).toBeDisabled()
  })

  it('filters to the current user\'s tasks when "My tasks" is toggled on', async () => {
    const user = userEvent.setup()
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /assigned to me/i }))
    expect(screen.getByText('Send invoice')).toBeInTheDocument()
    expect(screen.queryByText('Confirm rider')).not.toBeInTheDocument()
  })

  it('collapses the filters into a menu in compact view', async () => {
    const user = userEvent.setup()
    wrap(<TasksPage />, { compact: true })

    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    // No inline filter toggles; a single Filters button opens a menu instead.
    expect(screen.getByTestId('FilterAltIcon')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assigned to me' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finished' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /filters/i }))
    // The menu items carry the filter labels as plain text (no icons).
    expect(await screen.findByRole('menuitem', { name: 'Assigned to me' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Finished' })).toBeInTheDocument()
  })

  it('filters via the compact filter menu', async () => {
    const user = userEvent.setup()
    wrap(<TasksPage />, { compact: true })

    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /filters/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Assigned to me' }))
    expect(screen.getByText('Send invoice')).toBeInTheDocument()
    expect(screen.queryByText('Confirm rider')).not.toBeInTheDocument()
  })

  it('keeps filter text in desktop view', async () => {
    wrap(<TasksPage />)

    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Assigned to me' })).toHaveStyle({ height: '31px' })
    expect(screen.getByRole('button', { name: 'Finished' })).toHaveStyle({ height: '31px' })
    expect(screen.getByText('Assigned to me')).toBeInTheDocument()
    expect(screen.getByText('Finished')).toBeInTheDocument()
  })

  it('navigates to the gig tasks tab when the open-gig button is clicked', async () => {
    const user = userEvent.setup()
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    await user.click(screen.getAllByRole('button', { name: /open gig/i })[0])
    expect(navigate).toHaveBeenCalledWith('/gigs/1?tab=tasks')
  })

  it('toggles a gig-less task done via the top-level task API', async () => {
    const user = userEvent.setup()
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Buy strings')).toBeInTheDocument())
    // Buy strings is the third card; its checkbox is the third one.
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[2])
    expect(updateTask).toHaveBeenCalledWith(12, { done: true })
  })

  it('keeps the task grid visible during the post-toggle refresh', async () => {
    const user = userEvent.setup()
    let resolveRefresh
    const refresh = new Promise((resolve) => { resolveRefresh = resolve })
    listAllTasks
      .mockResolvedValueOnce(TASKS)
      .mockReturnValueOnce(refresh)

    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Buy strings')).toBeInTheDocument())
    await user.click(screen.getAllByRole('checkbox')[2])
    await waitFor(() => expect(listAllTasks).toHaveBeenCalledTimes(2))

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText('Confirm rider')).toBeInTheDocument()

    resolveRefresh(TASKS)
    await waitFor(() => expect(screen.getByText('Buy strings')).toBeInTheDocument())
  })

  it('creates a task through the dialog', async () => {
    const user = userEvent.setup()
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /new task/i }))
    const titleField = await screen.findByLabelText(/title/i)
    await user.type(titleField, 'Practice set')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    const [body] = createTask.mock.calls[0]
    expect(body).toMatchObject({ title: 'Practice set' })
    expect(body).not.toHaveProperty('gig_id')
    // List reloads after create (initial load + reload).
    expect(listAllTasks).toHaveBeenCalledTimes(2)
  })

  it('opens the edit dialog when a card is clicked and updates the task', async () => {
    const user = userEvent.setup()
    wrap(<TasksPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    await user.click(screen.getByText('Send invoice'))
    const titleField = await screen.findByLabelText(/title/i)
    expect(titleField).toHaveValue('Send invoice')
    await user.clear(titleField)
    await user.type(titleField, 'Send the invoice')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith(10, expect.objectContaining({ title: 'Send the invoice' })),
    )
  })

  describe('reader (no planning.write)', () => {
    beforeEach(() => {
      usePermissions.mockReturnValue({ canWritePlanning: false })
    })

    it('hides the New task button', async () => {
      wrap(<TasksPage />)
      await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument()
    })

    it('disables the checkbox for a task not assigned to the reader', async () => {
      wrap(<TasksPage />)
      await waitFor(() => expect(screen.getByText('Confirm rider')).toBeInTheDocument())
      const checkboxes = screen.getAllByRole('checkbox')
      // Send invoice (own, id 10) enabled; Confirm rider (Bob's, id 11) disabled.
      expect(checkboxes[0]).toBeEnabled()
      expect(checkboxes[1]).toBeDisabled()
    })
  })
})
