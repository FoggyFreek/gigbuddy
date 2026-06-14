import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The picker's only side effect is the debounced venue search.
vi.mock('../api/venues.ts', () => ({
  searchVenues: vi.fn().mockResolvedValue([]),
}))

import VenuePicker from '../components/VenuePicker.tsx'
import { searchVenues } from '../api/venues.ts'
import theme from '../theme.ts'

const VENUE = { id: 10, name: 'Big Hall', city: 'Amsterdam', category: 'venue' }
const VENUE_LABEL = 'Big Hall — Amsterdam' // venueOptionLabel(VENUE)

function ui(props = {}) {
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <VenuePicker categoryFilter="venue" onChange={() => {}} {...props} />
      </ThemeProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  searchVenues.mockReset().mockResolvedValue([])
})

describe('VenuePicker — search request hygiene', () => {
  it('does not search when mounted with a bound value (programmatic reset)', async () => {
    // MUI syncs the input to the selected option's label via an onInputChange
    // 'reset'. That label must NOT be treated as a user query, or every gig that
    // opens with a venue fires a wasted /venues/search request.
    vi.useFakeTimers()
    try {
      render(ui({ value: VENUE }))
      await act(async () => {
        await vi.runAllTimersAsync()
      })
      expect(searchVenues).not.toHaveBeenCalled()
    } finally {
      vi.runOnlyPendingTimers()
      vi.useRealTimers()
    }
  })

  it('searches when the user types at least 3 characters', async () => {
    const user = userEvent.setup()
    render(ui())

    await user.type(screen.getByRole('combobox'), 'Hal')

    await waitFor(() => expect(searchVenues).toHaveBeenCalledWith('Hal', 'venue'))
  })

  it('does not re-search when a picked value resets the input to its label', async () => {
    const user = userEvent.setup()
    const { rerender } = render(ui({ value: null }))

    // User types a query -> a search for that query.
    await user.type(screen.getByRole('combobox'), 'Big')
    await waitFor(() => expect(searchVenues).toHaveBeenCalledWith('Big', 'venue'))

    // Parent commits the pick -> value set -> MUI resets the input to the venue
    // label. That reset must not be searched.
    rerender(ui({ value: VENUE }))
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(VENUE_LABEL))

    // Wait past the debounce so a (buggy) reset-triggered search would have fired.
    await new Promise((r) => setTimeout(r, 400))

    expect(searchVenues).not.toHaveBeenCalledWith(VENUE_LABEL, 'venue')
    expect(searchVenues).toHaveBeenCalledTimes(1)
  })
})
