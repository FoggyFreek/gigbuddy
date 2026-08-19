import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../gigs.ts', () => ({
  addGigTimetableEntry: vi.fn(),
  updateGigTimetableEntry: vi.fn(),
  deleteGigTimetableEntry: vi.fn(),
  reorderGigTimetable: vi.fn(),
}))

import GigTimetable from '../components/gigdetails/GigTimetable.tsx'
import { DialogProvider } from '../../../contexts/DialogContext.tsx'
import {
  addGigTimetableEntry,
  deleteGigTimetableEntry,
  updateGigTimetableEntry,
} from '../gigs.ts'
import theme from '../../../theme.ts'

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}><MemoryRouter><DialogProvider>
      <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
    </DialogProvider></MemoryRouter></ThemeProvider>,
  )
}

function renderTimetable({ entries = [], editable = true } = {}) {
  return wrap(<GigTimetable gigId={1} editable={editable} initialEntries={entries} />)
}

// A picker field's name sits on the group of editable sections, which also
// carries the formatted time as its text.
function timeField(name, index = 0) {
  return screen.getAllByLabelText(name)[index]
}

// Description saves debounce at 600ms, past waitFor's default budget.
const SAVED = { timeout: 3000 }

const GET_IN = {
  id: 5,
  start_time: '19:00',
  end_time: '19:30',
  description: 'Get-in time',
  position: 0,
}

const DOORS = {
  id: 6,
  start_time: '20:00',
  end_time: '20:00',
  description: 'Doors',
  position: 1,
}

let nextId = 100

beforeEach(() => {
  vi.clearAllMocks()
  nextId = 100
  addGigTimetableEntry.mockImplementation(async () => ({
    id: (nextId += 1), start_time: null, end_time: null, description: '', position: 0,
  }))
  updateGigTimetableEntry.mockResolvedValue({})
  deleteGigTimetableEntry.mockResolvedValue(undefined)
})

describe('GigTimetable', () => {
  it('tells a gig with no timetable that it has none', () => {
    renderTimetable()
    expect(screen.getByText('No timetable yet.')).toBeInTheDocument()
  })

  it('renders the stored lines in order, times and all', () => {
    renderTimetable({ entries: [GET_IN, DOORS] })
    expect(screen.getAllByLabelText('Description').map((f) => f.value))
      .toEqual(['Get-in time', 'Doors'])
    expect(timeField('From')).toHaveTextContent('19:00')
    expect(timeField('Until')).toHaveTextContent('19:30')
  })

  it('shows a zero-length line as ending when it starts', () => {
    renderTimetable({ entries: [DOORS] })
    expect(timeField('From')).toHaveTextContent('20:00')
    expect(timeField('Until')).toHaveTextContent('20:00')
  })

  it('persists a new line as soon as it is added', async () => {
    const user = userEvent.setup()
    renderTimetable({ entries: [GET_IN] })

    await user.click(screen.getByRole('button', { name: 'Add line' }))

    await waitFor(() => expect(addGigTimetableEntry).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getAllByLabelText('Description')).toHaveLength(2))
    expect(screen.getAllByLabelText('Description')[1]).toHaveValue('')
  })

  it('saves a typed description once the typing settles', async () => {
    const user = userEvent.setup()
    renderTimetable({ entries: [GET_IN] })

    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), 'Load in')

    await waitFor(
      () => expect(updateGigTimetableEntry).toHaveBeenCalledWith(1, 5, { description: 'Load in' }),
      SAVED,
    )
  })

  it('commits a picked time straight away', async () => {
    const user = userEvent.setup()
    renderTimetable({ entries: [GET_IN] })

    await user.click(within(timeField('Until')).getByRole('spinbutton', { name: 'Hours' }))
    await user.keyboard('2100')

    await waitFor(() => expect(updateGigTimetableEntry).toHaveBeenCalledWith(1, 5, { end_time: '21:00' }))
  })

  it('clears a time back to empty', async () => {
    const user = userEvent.setup()
    renderTimetable({ entries: [GET_IN] })

    await user.click(within(timeField('Until')).getByRole('spinbutton', { name: 'Hours' }))
    await user.keyboard('{Backspace}{Backspace}')

    await waitFor(() => expect(updateGigTimetableEntry).toHaveBeenCalledWith(1, 5, { end_time: null }))
  })

  it('deletes a filled line after confirmation', async () => {
    const user = userEvent.setup()
    renderTimetable({ entries: [GET_IN] })

    await user.click(screen.getByRole('button', { name: 'Remove this line' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteGigTimetableEntry).toHaveBeenCalledWith(1, 5))
    await waitFor(() => expect(screen.queryByLabelText('Description')).not.toBeInTheDocument())
  })

  it('drops a blank line it just added without asking', async () => {
    const user = userEvent.setup()
    renderTimetable({
      entries: [{ id: 7, start_time: null, end_time: null, description: '', position: 0 }],
    })

    await user.click(screen.getByRole('button', { name: 'Remove this line' }))

    await waitFor(() => expect(deleteGigTimetableEntry).toHaveBeenCalledWith(1, 7))
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('gives a reader the timetable but no way to change it', () => {
    renderTimetable({ entries: [GET_IN], editable: false })

    expect(screen.getByLabelText('Description')).toHaveValue('Get-in time')
    expect(screen.queryByRole('button', { name: 'Add line' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove this line' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Drag to reorder this line' })).not.toBeInTheDocument()
  })

  it('surfaces a failed save', async () => {
    const user = userEvent.setup()
    updateGigTimetableEntry.mockRejectedValue(new Error('Network down'))
    renderTimetable({ entries: [GET_IN] })

    await user.type(screen.getByLabelText('Description'), '!')

    expect(await screen.findByText('Network down', {}, SAVED)).toBeInTheDocument()
  })
})
