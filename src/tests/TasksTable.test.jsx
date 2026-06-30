import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Controls the compact (single-column) vs desktop (grid) branch via useCompactLayout.
let mockIsMobile = false
vi.mock('@mui/material/useMediaQuery', () => ({ default: () => mockIsMobile }))

import TasksTable from '../components/TasksTable.tsx'
import i18n from '../i18n/index.ts'
import theme from '../theme.ts'

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
    assigned_to: 1,
    assigned_to_name: 'Alice',
  },
  {
    id: 11,
    gig_id: null,
    title: 'Buy strings',
    done: false,
    due_date: null,
    created_at: '2026-04-02T00:00:00.000Z',
    event_description: null,
    event_date: null,
    assigned_to: null,
    assigned_to_name: null,
  },
]

const noop = () => {}
const yes = () => true

describe('TasksTable', () => {
  beforeEach(async () => {
    mockIsMobile = false
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders task titles', () => {
    wrap(<TasksTable tasks={TASKS} onToggleDone={noop} canToggleDone={yes} onOpenGig={noop} />)
    expect(screen.getByText('Send invoice')).toBeInTheDocument()
    expect(screen.getByText('Buy strings')).toBeInTheDocument()
  })

  it('shows assignee name and due date for a gig-linked task', () => {
    wrap(<TasksTable tasks={TASKS} onToggleDone={noop} canToggleDone={yes} onOpenGig={noop} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('01 aug 2026')).toBeInTheDocument()
    expect(screen.getByText('Jazz Night')).toBeInTheDocument()
  })

  it('shows empty state when no tasks', () => {
    wrap(<TasksTable tasks={[]} onToggleDone={noop} canToggleDone={yes} onOpenGig={noop} />)
    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument()
  })

  it('renders the open-gig button only for tasks with a gig', () => {
    wrap(<TasksTable tasks={TASKS} onToggleDone={noop} canToggleDone={yes} onOpenGig={noop} />)
    // One gig-linked task → exactly one open-gig button.
    expect(screen.getAllByRole('button', { name: /open gig/i })).toHaveLength(1)
  })

  it('groups tasks for the same gig in one card ordered by due date', () => {
    const tasks = [
      { ...TASKS[0], id: 12, title: 'No deadline', due_date: null },
      { ...TASKS[0], id: 13, title: 'Later task', due_date: '2026-09-01' },
      { ...TASKS[0], id: 14, title: 'Earlier task', due_date: '2026-07-01' },
      TASKS[1],
    ]

    const { container } = wrap(
      <TasksTable tasks={tasks} onToggleDone={noop} canToggleDone={yes} onOpenGig={noop} />,
    )

    const cards = container.querySelectorAll('[data-card]')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getAllByText(/Earlier task|Later task|No deadline/).map((node) => node.textContent))
      .toEqual(['Earlier task', 'Later task', 'No deadline'])
    expect(within(cards[1]).getByText('Buy strings')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /open gig/i })).toHaveLength(1)
  })

  it('calls onOpenGig with the gig id without opening the editor', async () => {
    const user = userEvent.setup()
    const onOpenGig = vi.fn()
    const onEditTask = vi.fn()
    wrap(
      <TasksTable
        tasks={TASKS}
        onToggleDone={noop}
        canToggleDone={yes}
        onOpenGig={onOpenGig}
        onEditTask={onEditTask}
      />,
    )
    await user.click(screen.getByRole('button', { name: /open gig/i }))
    expect(onOpenGig).toHaveBeenCalledWith(1)
    expect(onEditTask).not.toHaveBeenCalled()
  })

  it('opens the editor when the card body is clicked', async () => {
    const user = userEvent.setup()
    const onEditTask = vi.fn()
    wrap(
      <TasksTable tasks={TASKS} onToggleDone={noop} canToggleDone={yes} onOpenGig={noop} onEditTask={onEditTask} />,
    )
    await user.click(screen.getByText('Send invoice'))
    expect(onEditTask).toHaveBeenCalledWith(TASKS[0])
  })

  it('toggles done via checkbox without opening the editor', async () => {
    const user = userEvent.setup()
    const onToggleDone = vi.fn()
    const onEditTask = vi.fn()
    wrap(
      <TasksTable
        tasks={TASKS}
        onToggleDone={onToggleDone}
        canToggleDone={yes}
        onOpenGig={noop}
        onEditTask={onEditTask}
      />,
    )
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])
    expect(onToggleDone).toHaveBeenCalledWith(TASKS[0])
    expect(onEditTask).not.toHaveBeenCalled()
  })

  it('disables the checkbox when canToggleDone returns false', () => {
    wrap(
      <TasksTable
        tasks={[TASKS[0]]}
        onToggleDone={noop}
        canToggleDone={() => false}
        onOpenGig={noop}
      />,
    )
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })

  it('disables a finished task and does not open its editor', async () => {
    const user = userEvent.setup()
    const onEditTask = vi.fn()
    const finishedTask = { ...TASKS[0], done: true }
    wrap(
      <TasksTable
        tasks={[finishedTask]}
        onToggleDone={noop}
        canToggleDone={yes}
        onOpenGig={noop}
        onEditTask={onEditTask}
      />,
    )

    expect(screen.getByRole('checkbox')).toBeDisabled()
    await user.click(screen.getByText('Send invoice'))
    expect(onEditTask).not.toHaveBeenCalled()
  })

  it('shows localized relative labels for due dates less than one week away', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'))
    await i18n.changeLanguage('nl')
    const tasks = [
      { ...TASKS[0], id: 20, title: 'One day away', due_date: '2026-07-02' },
      { ...TASKS[0], id: 21, title: 'Two days away', due_date: '2026-07-03' },
      { ...TASKS[0], id: 22, title: 'One week away', due_date: '2026-07-08' },
    ]

    wrap(<TasksTable tasks={tasks} onToggleDone={noop} canToggleDone={yes} onOpenGig={noop} />)

    expect(screen.getByText('morgen')).toBeInTheDocument()
    expect(screen.getByText('over 2 dagen')).toBeInTheDocument()
    expect(screen.getByText('08 jul 2026')).toBeInTheDocument()
  })

  it('renders as cards in compact layout too', () => {
    mockIsMobile = true
    wrap(<TasksTable tasks={TASKS} onToggleDone={noop} canToggleDone={yes} onOpenGig={noop} />)
    expect(screen.getByText('Send invoice')).toBeInTheDocument()
    expect(screen.getByText('Buy strings')).toBeInTheDocument()
  })
})
