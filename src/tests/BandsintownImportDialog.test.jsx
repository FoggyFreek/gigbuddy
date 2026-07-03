import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BandsintownImportDialog from '../components/BandsintownImportDialog.tsx'
import { importBandsintownEvents } from '../api/bandsintown.ts'
import theme from '../theme.ts'

vi.mock('../api/gigs.ts', () => ({
  listGigs: vi.fn().mockResolvedValue([]),
}))

vi.mock('../api/bandsintown.ts', () => ({
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

const CSV = [
  'Event Id,Start Date* (yyyy-mm-dd),Event Name,Venue*,City*,Start Time* (HH:MM),Ticket Type,Ticket Link',
  '108197116,2026-07-06,Tall Ships Races 2026,Tall Ships Races 2026,Harlingen,15:00,Free,',
].join('\n')

async function uploadCsv() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Choose CSV file' }))
  const input = document.querySelector('input[type="file"]')
  const file = new File([CSV], 'events.csv', { type: 'text/csv' })
  await user.upload(input, file)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BandsintownImportDialog (CSV)', () => {
  it('marks unmatched rows for venue creation and imports via the bandsintown endpoint', async () => {
    importBandsintownEvents.mockResolvedValue({ created: 1, skipped: 0, venues_created: 1 })
    wrap(<BandsintownImportDialog onClose={() => {}} />)

    await uploadCsv()

    expect(await screen.findByText('Will be created: Tall Ships Races 2026')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Import 1 gig' }))
    await waitFor(() => {
      expect(importBandsintownEvents).toHaveBeenCalledTimes(1)
    })

    const rows = importBandsintownEvents.mock.calls[0][0]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      bandsintown_event_id: '108197116',
      event_date: '2026-07-06',
      event_description: 'Tall Ships Races 2026',
      start_time: '15:00',
      admission: 'free',
      venue_id: null,
      category: 'venue',
      status: 'confirmed',
    })
    expect(rows[0].venue).toMatchObject({ name: 'Tall Ships Races 2026', city: 'Harlingen' })

    expect(await screen.findByText(/1 gig imported\./)).toBeInTheDocument()
    expect(screen.getByText(/1 venue created\./)).toBeInTheDocument()
  })
})
