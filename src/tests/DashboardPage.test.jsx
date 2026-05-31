import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/gigs.js', () => ({ listGigs: vi.fn() }))
vi.mock('../api/rehearsals.js', () => ({ listRehearsals: vi.fn() }))
vi.mock('../api/bandEvents.js', () => ({ listBandEvents: vi.fn() }))
vi.mock('../api/invoices.js', () => ({ listInvoices: vi.fn() }))
vi.mock('../api/tasks.js', () => ({ listAllTasks: vi.fn() }))
vi.mock('../api/availability.js', () => ({ listAvailability: vi.fn() }))
vi.mock('../api/bandMembers.js', () => ({ listMembers: vi.fn() }))
vi.mock('../contexts/authContext.js', () => ({ useAuth: vi.fn() }))

import DashboardPage from '../pages/DashboardPage.jsx'
import { listGigs } from '../api/gigs.js'
import { listRehearsals } from '../api/rehearsals.js'
import { listBandEvents } from '../api/bandEvents.js'
import { listInvoices } from '../api/invoices.js'
import { listAllTasks } from '../api/tasks.js'
import { listAvailability } from '../api/availability.js'
import { listMembers } from '../api/bandMembers.js'
import { useAuth } from '../contexts/authContext.js'
import theme from '../theme.js'

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
const REHEARSALS = [
  { id: 20, proposed_date: '2026-06-01', location: 'Studio A', status: 'planned' },
  { id: 21, proposed_date: '2026-02-01', location: 'Old Studio', status: 'planned' },
]
const EVENTS = [
  { id: 30, title: 'Band Meeting', start_date: '2026-06-05', end_date: '2026-06-05', location: 'Bar' },
  { id: 31, title: 'Old Event', start_date: '2026-01-01', end_date: '2026-01-01', location: 'Somewhere' },
]
const INVOICES = [
  { id: 40, invoice_number: '2026-001', customer_name: 'Acme', total_cents: 50000, status: 'sent', due_date: '2026-06-10' },
  { id: 41, invoice_number: '2026-002', customer_name: 'Beta', total_cents: 20000, status: 'draft', due_date: null },
  { id: 42, invoice_number: '2026-003', customer_name: 'Gamma', total_cents: 10000, status: 'paid', due_date: '2026-05-01' },
  { id: 43, invoice_number: '2026-004', customer_name: 'Delta', total_cents: 30000, status: 'void', due_date: null },
]
const TASKS = [
  { id: 50, gig_id: 3, title: 'Send invoice', done: false, due_date: null, assigned_to: 7, event_description: 'Tour Stop' },
  { id: 51, gig_id: 2, title: 'Confirm rider', done: false, due_date: '2026-06-01', assigned_to: 9, event_description: 'Jazz Night' },
  { id: 52, gig_id: 5, title: 'Book hotel', done: true, due_date: null, assigned_to: 7, event_description: 'Winter Tour' },
]
// availability_slots: band_member_id null means the whole band; DATE columns.
const AVAILABILITY = [
  { id: 60, band_member_id: 7, start_date: '2026-06-20', end_date: '2026-06-22', status: 'unavailable', reason: 'Holiday' },
  { id: 61, band_member_id: null, start_date: '2026-06-25', end_date: '2026-06-25', status: 'available', reason: null },
  { id: 62, band_member_id: 9, start_date: '2026-01-01', end_date: '2026-01-02', status: 'unavailable', reason: 'old' },
]
const MEMBERS = [
  { id: 7, name: 'Alice', color: '#f00' },
  { id: 9, name: 'Bob', color: '#0f0' },
]

function resolveAll() {
  listGigs.mockResolvedValue(GIGS)
  listRehearsals.mockResolvedValue(REHEARSALS)
  listBandEvents.mockResolvedValue(EVENTS)
  listInvoices.mockResolvedValue(INVOICES)
  listAllTasks.mockResolvedValue(TASKS)
  listAvailability.mockResolvedValue(AVAILABILITY)
  listMembers.mockResolvedValue(MEMBERS)
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
    expect(screen.getByText('Cafe X · Amsterdam')).toBeInTheDocument()
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

  it('shows upcoming rehearsals and events, excluding past ones', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Studio A')).toBeInTheDocument())
    expect(screen.getByText('Band Meeting')).toBeInTheDocument()
    expect(screen.queryByText('Old Studio')).not.toBeInTheDocument()
    expect(screen.queryByText('Old Event')).not.toBeInTheDocument()
  })

  it('shows only open invoices, excluding paid and void', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument())
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.queryByText('Gamma')).not.toBeInTheDocument()
    expect(screen.queryByText('Delta')).not.toBeInTheDocument()
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
    listRehearsals.mockResolvedValue([])
    listBandEvents.mockResolvedValue([])
    listInvoices.mockResolvedValue([])
    listAllTasks.mockResolvedValue([])
    listAvailability.mockResolvedValue([])
    listMembers.mockResolvedValue([])
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText(/no upcoming shows/i)).toBeInTheDocument())
    expect(screen.getByText(/no open invoices/i)).toBeInTheDocument()
    expect(screen.getByText(/no open tasks/i)).toBeInTheDocument()
  })

  it('shows a count badge reflecting the full total, not the capped 5 rows', async () => {
    // 7 open invoices: only 5 rows render, but the badge must read 7.
    const manyInvoices = Array.from({ length: 7 }, (_, i) => ({
      id: 100 + i,
      invoice_number: `2026-1${i}`,
      customer_name: `Customer ${i}`,
      total_cents: 1000,
      status: 'sent',
      due_date: '2026-06-10',
    }))
    listInvoices.mockResolvedValue(manyInvoices)
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Open invoices')).toBeInTheDocument())
    expect(screen.getByText('7')).toBeInTheDocument()
    // Capped at 5 rendered rows.
    expect(screen.getByText('Customer 0')).toBeInTheDocument()
    expect(screen.queryByText('Customer 5')).not.toBeInTheDocument()
  })

  it('shows availability records alongside band events, by member, excluding past slots', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Band Meeting')).toBeInTheDocument())
    // member-scoped slot shows the member name; band-wide slot shows "Band"
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Band')).toBeInTheDocument()
    // a past slot (ended in January) is excluded — Bob has no upcoming slot
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
    // status is shown in the secondary line, alongside the date range
    expect(screen.getByText(/22 jun 2026\) unavailable/i)).toBeInTheDocument()
    expect(screen.getByText(/25 jun 2026\) available/i)).toBeInTheDocument()
  })

  it('renders an availability date range only when end differs from start', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    // multi-day slot (20–22 Jun) renders a range with a dash; single-day does not
    expect(screen.getByText(/20 jun 2026 – 22 jun 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/25 jun 2026 –/)).not.toBeInTheDocument()
  })

  it('points the calendar card "view all" at the calendar, not the band-events page', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Calendar events')).toBeInTheDocument())
    const links = screen.getAllByRole('link')
    expect(links.some((l) => l.getAttribute('href') === '/availability')).toBe(true)
    expect(links.some((l) => l.getAttribute('href') === '/events')).toBe(false)
  })

  it('shows a per-card error when one source fails, while the others still render', async () => {
    listInvoices.mockRejectedValue(new Error('boom'))
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument()
    // a healthy card still renders
    expect(screen.getByText('Send invoice')).toBeInTheDocument()
  })
})
