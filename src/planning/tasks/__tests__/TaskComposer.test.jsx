import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'
import { describe, expect, it, vi } from 'vitest'
import TaskComposer from '../../gigs/components/gigdetails/TaskComposer.tsx'
import theme from '../../../theme.ts'

const MEMBERS = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
]

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
    </ThemeProvider>,
  )
}

describe('TaskComposer', () => {
  it('starts collapsed and expands when the add icon is clicked', async () => {
    const user = userEvent.setup()
    wrap(<TaskComposer members={MEMBERS} onAdd={vi.fn()} />)

    const input = screen.getByPlaceholderText(/add task/i)
    expect(screen.queryByRole('button', { name: /set due date/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add task/i }))

    expect(input).toHaveFocus()
    expect(screen.getByRole('button', { name: /set due date/i })).toBeInTheDocument()
  })

  it('collapses an empty draft when the description loses focus', async () => {
    const user = userEvent.setup()
    wrap(
      <>
        <TaskComposer members={MEMBERS} onAdd={vi.fn()} />
        <button type="button">Outside</button>
      </>,
    )

    await user.click(screen.getByPlaceholderText(/add task/i))
    expect(screen.getByRole('button', { name: /set due date/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Outside' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /set due date/i })).not.toBeInTheDocument(),
    )
  })

  it('keeps the add button disabled until a title is typed', async () => {
    const user = userEvent.setup()
    wrap(<TaskComposer members={MEMBERS} onAdd={vi.fn()} />)

    await user.click(screen.getByPlaceholderText(/add task/i))
    const addButton = screen.getByRole('button', { name: /^add$/i })
    expect(addButton).toBeDisabled()

    await user.type(screen.getByPlaceholderText(/add task/i), 'Load in at 17:00')
    expect(addButton).toBeEnabled()
  })

  it('submits the typed title with no date or assignee', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockResolvedValue(undefined)
    wrap(<TaskComposer members={MEMBERS} onAdd={onAdd} />)

    await user.type(screen.getByPlaceholderText(/add task/i), 'Check PA system')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ title: 'Check PA system', due_date: null, assigned_to: null }),
    )
  })

  it('submits on Enter and clears the draft afterwards', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockResolvedValue(undefined)
    wrap(<TaskComposer members={MEMBERS} onAdd={onAdd} />)

    const input = screen.getByPlaceholderText(/add task/i)
    await user.type(input, 'Prepare set list{Enter}')

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ title: 'Prepare set list', due_date: null, assigned_to: null }),
    )
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('submits a due date picked from the calendar', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockResolvedValue(undefined)
    wrap(<TaskComposer members={MEMBERS} onAdd={onAdd} />)

    await user.type(screen.getByPlaceholderText(/add task/i), 'Confirm backline')
    await user.click(screen.getByRole('button', { name: /set due date/i }))
    await user.click(await screen.findByRole('gridcell', { name: '15' }))
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({
        title: 'Confirm backline',
        due_date: dayjs().date(15).format('YYYY-MM-DD'),
        assigned_to: null,
      }),
    )
  })

  it('submits an assignee picked from the member menu', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockResolvedValue(undefined)
    wrap(<TaskComposer members={MEMBERS} onAdd={onAdd} />)

    await user.type(screen.getByPlaceholderText(/add task/i), 'Bring merch box')
    await user.click(screen.getByRole('button', { name: /assign/i }))
    await user.click(await screen.findByRole('menuitem', { name: 'Bob' }))
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ title: 'Bring merch box', due_date: null, assigned_to: 2 }),
    )
  })

  it('does not offer assignment when no members are given', () => {
    wrap(<TaskComposer members={[]} onAdd={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /assign/i })).not.toBeInTheDocument()
  })

  it('ignores a whitespace-only title', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    wrap(<TaskComposer members={MEMBERS} onAdd={onAdd} />)

    await user.type(screen.getByPlaceholderText(/add task/i), '   {Enter}')
    expect(onAdd).not.toHaveBeenCalled()
  })
})
