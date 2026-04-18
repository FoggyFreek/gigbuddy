import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import TasksTable from '../components/TasksTable.jsx'
import theme from '../theme.js'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const TASKS = [
  {
    id: 10,
    gig_id: 1,
    title: 'Send invoice',
    done: false,
    due_date: '2026-08-01T00:00:00.000Z',
    created_at: '2026-04-01T00:00:00.000Z',
    event_description: 'Jazz Night',
    event_date: '2026-06-15T00:00:00.000Z',
  },
  {
    id: 11,
    gig_id: 2,
    title: 'Confirm rider',
    done: true,
    due_date: null,
    created_at: '2026-04-02T00:00:00.000Z',
    event_description: 'Summer Festival',
    event_date: '2026-07-01T00:00:00.000Z',
  },
]

describe('TasksTable', () => {
  it('renders column headers', () => {
    wrap(<TasksTable tasks={[]} onRowClick={() => {}} onToggleDone={() => {}} />)
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Due date')).toBeInTheDocument()
    expect(screen.getByText('Gig')).toBeInTheDocument()
  })

  it('shows empty state when no tasks', () => {
    wrap(<TasksTable tasks={[]} onRowClick={() => {}} onToggleDone={() => {}} />)
    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument()
  })

  it('renders task rows with title, due date, and gig description', () => {
    wrap(<TasksTable tasks={TASKS} onRowClick={() => {}} onToggleDone={() => {}} />)
    expect(screen.getByText('Send invoice')).toBeInTheDocument()
    expect(screen.getByText('Confirm rider')).toBeInTheDocument()
    expect(screen.getByText('Jazz Night')).toBeInTheDocument()
    expect(screen.getByText('Summer Festival')).toBeInTheDocument()
    expect(screen.getByText('01-08-2026')).toBeInTheDocument()
  })

  it('calls onRowClick with the task when a row is clicked', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    wrap(<TasksTable tasks={TASKS} onRowClick={onRowClick} onToggleDone={() => {}} />)
    await user.click(screen.getByText('Send invoice'))
    expect(onRowClick).toHaveBeenCalledWith(TASKS[0])
  })

  it('toggles done via checkbox without firing onRowClick', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    const onToggleDone = vi.fn()
    wrap(<TasksTable tasks={TASKS} onRowClick={onRowClick} onToggleDone={onToggleDone} />)
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])
    expect(onToggleDone).toHaveBeenCalledWith(TASKS[0])
    expect(onRowClick).not.toHaveBeenCalled()
  })
})
