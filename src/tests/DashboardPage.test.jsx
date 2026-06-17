import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/gigs.ts', () => ({ listGigs: vi.fn() }))
vi.mock('../api/rehearsals.ts', () => ({ getNextRehearsal: vi.fn() }))
vi.mock('../api/bandEvents.ts', () => ({ listBandEvents: vi.fn() }))
vi.mock('../api/tasks.ts', () => ({ listAllTasks: vi.fn() }))
vi.mock('../contexts/authContext.ts', () => ({ useAuth: vi.fn() }))
// The world-map tile loads its own data (and Leaflet); stub it so these tests stay
// focused on the dashboard sections and listGigs is only called by the page itself.
vi.mock('../components/dashboard/GigMapTile.tsx', () => ({
  default: () => <div data-testid="gig-map-tile" />,
}))
vi.mock('../api/profile.ts', () => ({ getProfile: vi.fn() }))

import DashboardPage from '../pages/DashboardPage.tsx'
import { listGigs } from '../api/gigs.ts'
import { getNextRehearsal } from '../api/rehearsals.ts'
import { listBandEvents } from '../api/bandEvents.ts'
import { listAllTasks } from '../api/tasks.ts'
import { getProfile } from '../api/profile.ts'
import { useAuth } from '../contexts/authContext.ts'
import theme from '../theme.ts'

function GigDetailProbe() {
  const { id } = useParams()
  return <div>gig-detail-{id}</div>
}

function wrap(ui) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/gigs/:id" element={<GigDetailProbe />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>
  )
}

// "today" is fixed at 2026-05-30 for all tests below.
// venue/festival arrive as nested objects (see gigRepository VENUE_JSON_SELECT);
// city lives inside them, there is no flat gig.city.
const GIGS = [
  { id: 1, event_date: '2026-01-10', event_description: 'Past Show', venue: { id: 11, name: 'Old Hall', city: 'Utrecht' }, festival: null, status: 'confirmed' },
  { id: 2, event_date: '2026-06-15', event_description: 'Jazz Night', venue: { id: 12, name: 'Cafe X', city: 'Amsterdam' }, festival: null, status: 'confirmed', banner_path: 'tenants/1/gig-banners/abc.png' },
  { id: 3, event_date: '2026-07-01', event_description: 'Summer Festival', venue: null, festival: { id: 13, name: 'Park Fest', city: 'Rotterdam' }, status: 'announced' },
]
// The dashboard asks the server for the single next rehearsal (GET /rehearsals/next);
// upcoming/past filtering happens server-side, so the mock returns one rehearsal or null.
const NEXT_REHEARSAL = { id: 20, proposed_date: '2026-06-01', location: 'Studio A', status: 'planned' }
const TASKS = [
  { id: 50, gig_id: 3, title: 'Send invoice', done: false, due_date: null, assigned_to: 7, event_description: 'Tour Stop' },
  { id: 51, gig_id: 2, title: 'Confirm rider', done: false, due_date: '2026-06-01', assigned_to: 9, event_description: 'Jazz Night' },
  { id: 52, gig_id: 5, title: 'Book hotel', done: true, due_date: null, assigned_to: 7, event_description: 'Winter Tour' },
]
function resolveAll() {
  listGigs.mockResolvedValue(GIGS)
  getNextRehearsal.mockResolvedValue(NEXT_REHEARSAL)
  listBandEvents.mockResolvedValue([])
  listAllTasks.mockResolvedValue(TASKS)
  getProfile.mockResolvedValue({ logo_path: null })
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-05-30T12:00:00Z'))
    useAuth.mockReturnValue({ user: { id: 1, bandMemberId: 7 } })
    resolveAll()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('shows the next upcoming gig and upcoming shows, excluding past gigs', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
    expect(screen.getByText('Summer Festival')).toBeInTheDocument()
    expect(screen.queryByText('Past Show')).not.toBeInTheDocument()
  })

  it('shows the next gig venue and city, and the festival city for a festival show', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
    // Next gig: venue name and its city, derived from the nested venue object.
    expect(screen.getByText('Cafe X, Amsterdam')).toBeInTheDocument()
    // Upcoming show backed by a festival: city comes from the festival object.
    expect(screen.getByText(/Rotterdam/)).toBeInTheDocument()
  })

  it('shows the next gig banner when the gig has one', async () => {
    const { container } = wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
    const img = container.querySelector('img[src="/api/files/tenants/1/gig-banners/abc.png"]')
    expect(img).not.toBeNull()
  })

  it('derives both gig cards from a single listGigs call', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
    expect(listGigs).toHaveBeenCalledTimes(1)
  })

  it('shows the next rehearsal returned by getNextRehearsal', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Studio A')).toBeInTheDocument())
    expect(getNextRehearsal).toHaveBeenCalledTimes(1)
  })

  it('does not render invoice or purchase cards (moved to the financial dashboard)', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
    expect(screen.queryByText('Open invoices')).not.toBeInTheDocument()
    expect(screen.queryByText('Open purchases')).not.toBeInTheDocument()
  })

  it('shows only open tasks assigned to the current member', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    expect(screen.queryByText('Confirm rider')).not.toBeInTheDocument() // assigned to someone else
    expect(screen.queryByText('Book hotel')).not.toBeInTheDocument() // done
  })

  it('navigates to the gig detail when a task row is clicked', async () => {
    const user = userEvent.setup()
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Send invoice')).toBeInTheDocument())
    await user.click(screen.getByText('Send invoice'))
    expect(screen.getByText('gig-detail-3')).toBeInTheDocument()
  })

  it('renders empty states when sources return nothing', async () => {
    listGigs.mockResolvedValue([])
    getNextRehearsal.mockResolvedValue(null)
    listAllTasks.mockResolvedValue([])
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText(/no upcoming shows/i)).toBeInTheDocument())
    expect(screen.getByText(/no open tasks/i)).toBeInTheDocument()
  })

  it('shows a count badge reflecting the full total, not the capped 5 rows', async () => {
    // 7 open tasks for member 7: only 5 rows render, but the badge must read 7.
    const manyTasks = Array.from({ length: 7 }, (_, i) => ({
      id: 100 + i,
      gig_id: 3,
      title: `Task ${i}`,
      done: false,
      due_date: '2026-06-10',
      assigned_to: 7,
      event_description: 'Tour Stop',
    }))
    listAllTasks.mockResolvedValue(manyTasks)
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('My tasks')).toBeInTheDocument())
    expect(screen.getByText('7')).toBeInTheDocument()
    // Capped at 5 rendered rows.
    expect(screen.getByText('Task 0')).toBeInTheDocument()
    expect(screen.queryByText('Task 5')).not.toBeInTheDocument()
  })

  it('shows a per-card error when one source fails, while the others still render', async () => {
    getNextRehearsal.mockRejectedValue(new Error('boom'))
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument()
    // a healthy card still renders
    expect(screen.getByText('Send invoice')).toBeInTheDocument()
  })
})
