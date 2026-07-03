import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BandsintownApiImportDialog from '../components/BandsintownApiImportDialog.tsx'
import { getBandsintownEvents, importBandsintownEvents } from '../api/bandsintown.ts'
import theme from '../theme.ts'

vi.mock('../api/bandsintown.ts', () => ({
  getBandsintownEvents: vi.fn(),
  importBandsintownEvents: vi.fn(),
}))

vi.mock('../api/venues.ts', () => ({
  searchVenues: vi.fn().mockResolvedValue([]),
}))

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>,
  )
}

const VENUE = {
  name: 'Tall Ships Races 2026',
  city: 'Harlingen',
  region: '',
  country: 'Netherlands',
  postal_code: '8862 RZ',
  street_address: 'Nieuwe Willemshaven 5',
  location: 'Harlingen, Netherlands',
  latitude: '53.17',
  longitude: '5.41',
}

function event(overrides = {}) {
  return {
    bandsintown_event_id: '108197116',
    event_date: '2026-07-06',
    event_description: 'Tall Ships Races 2026',
    start_time: '15:00',
    end_time: '16:00',
    event_link: 'https://www.bandsintown.com/e/108197116',
    ticket_link: null,
    admission: 'free',
    is_festival: false,
    venue: VENUE,
    matched_venue: null,
    is_duplicate: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BandsintownApiImportDialog', () => {
  it('lists fetched events, pre-unchecks duplicates and marks new venues', async () => {
    getBandsintownEvents.mockResolvedValue({
      artist: { id: '15556138', name: 'The Woods (NL)' },
      events: [
        event(),
        event({
          bandsintown_event_id: '2',
          event_date: '2026-08-23',
          event_description: 'Schokker blues',
          is_duplicate: true,
          matched_venue: { id: 7, name: 'Schokker blues', category: 'venue', city: 'Schokland', score: 1 },
        }),
      ],
    })

    wrap(<BandsintownApiImportDialog onClose={() => {}} />)

    // Event description and Bandsintown venue name both render the text.
    expect(await screen.findAllByText('Tall Ships Races 2026', { selector: 'p' })).not.toHaveLength(0)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).not.toBeChecked()
    expect(screen.getByText('Will be created: Tall Ships Races 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 1 gig' })).toBeInTheDocument()
  })

  it('imports the selected rows and shows the summary', async () => {
    getBandsintownEvents.mockResolvedValue({
      artist: { id: '15556138', name: 'The Woods (NL)' },
      events: [event()],
    })
    importBandsintownEvents.mockResolvedValue({ created: 1, skipped: 0, venues_created: 1 })

    wrap(<BandsintownApiImportDialog onClose={() => {}} />)

    const importButton = await screen.findByRole('button', { name: 'Import 1 gig' })
    await userEvent.click(importButton)

    await waitFor(() => {
      expect(importBandsintownEvents).toHaveBeenCalledTimes(1)
    })
    const rows = importBandsintownEvents.mock.calls[0][0]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      bandsintown_event_id: '108197116',
      event_date: '2026-07-06',
      event_link: null,
      venue_id: null,
      category: 'venue',
      status: 'confirmed',
      venue: VENUE,
    })
    expect(await screen.findByText(/1 gig imported\./)).toBeInTheDocument()
    expect(screen.getByText(/1 venue created\./)).toBeInTheDocument()
  })

  it('shows the server error when fetching events fails', async () => {
    getBandsintownEvents.mockRejectedValue(new Error('Bandsintown integration is not configured'))

    wrap(<BandsintownApiImportDialog onClose={() => {}} />)

    expect(await screen.findByText('Bandsintown integration is not configured')).toBeInTheDocument()
  })
})
