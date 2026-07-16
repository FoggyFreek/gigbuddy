import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/gigs.ts', () => ({
  listGigs: vi.fn(),
  listUpcomingGigs: vi.fn(),
  getGig: vi.fn(),
  searchGigs: vi.fn(),
}))
vi.mock('../api/rehearsals.ts', () => ({ getNextRehearsal: vi.fn() }))
vi.mock('../api/bandEvents.ts', () => ({ listUpcomingBandEvents: vi.fn() }))
vi.mock('../api/tasks.ts', () => ({ listTasks: vi.fn() }))
vi.mock('../contexts/authContext.ts', () => ({ useAuth: vi.fn() }))
// The world-map tile loads its own data (and Leaflet); stub it so these tests stay
// focused on the dashboard sections and can detect any full-list gig request.
vi.mock('../components/dashboard/GigMapTile.tsx', () => ({
  default: () => <div data-testid="gig-map-tile" />,
}))
vi.mock('../api/profile.ts', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  uploadMemoryImage: vi.fn(),
}))
vi.mock('../api/achievements.ts', () => ({ listAchievements: vi.fn() }))

import DashboardPage from '../pages/DashboardPage.tsx'
import { listGigs, listUpcomingGigs, getGig, searchGigs } from '../api/gigs.ts'
import { getNextRehearsal } from '../api/rehearsals.ts'
import { listUpcomingBandEvents } from '../api/bandEvents.ts'
import { listTasks } from '../api/tasks.ts'
import { getProfile, updateProfile } from '../api/profile.ts'
import { listAchievements } from '../api/achievements.ts'
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
          <Route path="/tasks" element={<div>tasks-page</div>} />
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
// Five unlocked achievements (mixed order) plus a locked one; the card must show
// the three most recent by unlocked_at and ignore locked entries.
const ACHIEVEMENTS = [
  { key: 'welcome_to_the_giggle', category: 'platform', cheers: 1, unlocked_at: '2026-01-01T10:00:00Z' },
  { key: 'calendar_rock', category: 'gigs', cheers: 1, unlocked_at: '2026-05-20T10:00:00Z' },
  { key: 'first_rehearsal_last_excuse', category: 'gigs', cheers: 1, unlocked_at: '2026-02-01T10:00:00Z' },
  { key: 'three_chords_three_humans', category: 'profile', cheers: 2, unlocked_at: '2026-05-25T10:00:00Z' },
  { key: 'now_were_photogenic', category: 'profile', cheers: 1, unlocked_at: '2026-04-01T10:00:00Z' },
  { key: 'tour_bus_not_included', category: 'gigs', cheers: 10, unlocked_at: null },
]

const collection = (items, limit, total = items.length) => ({
  items,
  meta: { limit, returned: items.length, total },
})

function resolveAll() {
  listGigs.mockResolvedValue(GIGS)
  searchGigs.mockResolvedValue([])
  listUpcomingGigs.mockResolvedValue(collection(GIGS.filter((gig) => gig.id !== 1), 6))
  getGig.mockImplementation((id) => Promise.resolve(GIGS.find((gig) => gig.id === id)))
  getNextRehearsal.mockResolvedValue(NEXT_REHEARSAL)
  listUpcomingBandEvents.mockResolvedValue(collection([], 1))
  listTasks.mockResolvedValue(collection(TASKS.filter((task) => !task.done && task.assigned_to === 7), 5))
  getProfile.mockResolvedValue({ logo_path: null })
  listAchievements.mockResolvedValue([])
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

  it('fetches the six gigs needed by both gig cards', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
    const today = new Date()
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(listUpcomingGigs).toHaveBeenCalledWith(6, localToday)
    expect(listTasks).toHaveBeenCalledWith({ limit: 5, assignee: 'me', done: false })
    expect(listUpcomingBandEvents).toHaveBeenCalledWith(1, localToday)
    expect(listGigs).not.toHaveBeenCalled()
  })

  it('shows the next rehearsal returned by the limited upcoming endpoint', async () => {
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

  it('navigates to the tasks page when a gig-less task is clicked', async () => {
    const user = userEvent.setup()
    listTasks.mockResolvedValue(collection([
      { id: 60, gig_id: null, title: 'Standalone chore', done: false, due_date: null, assigned_to: 7, event_description: null },
    ], 5))
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Standalone chore')).toBeInTheDocument())
    await user.click(screen.getByText('Standalone chore'))
    expect(screen.getByText('tasks-page')).toBeInTheDocument()
  })

  it('renders empty states when sources return nothing', async () => {
    listUpcomingGigs.mockResolvedValue(collection([], 6))
    getNextRehearsal.mockResolvedValue(null)
    listTasks.mockResolvedValue(collection([], 5))
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
    listTasks.mockResolvedValue(collection(manyTasks.slice(0, 5), 5, 7))
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('My tasks')).toBeInTheDocument())
    expect(screen.getByText('7')).toBeInTheDocument()
    // Capped at 5 rendered rows.
    expect(screen.getByText('Task 0')).toBeInTheDocument()
    expect(screen.queryByText('Task 5')).not.toBeInTheDocument()
  })

  it('derives the shows badge from the same limited response as the rows', async () => {
    const gigs = Array.from({ length: 6 }, (_, i) => ({
      id: 200 + i,
      event_date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      event_description: `Atomic show ${i}`,
      venue: null,
      festival: null,
      status: 'confirmed',
    }))
    // Nine upcoming gigs total: one is featured and five remain visible, while
    // the shows badge reports all eight non-featured gigs from the same envelope.
    listUpcomingGigs.mockResolvedValue(collection(gigs, 6, 9))
    wrap(<DashboardPage />)

    await waitFor(() => expect(screen.getByText('Atomic show 0')).toBeInTheDocument())
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('Atomic show 5')).toBeInTheDocument()
  })

  it('shows the 3 most recently unlocked achievements with a Show all link', async () => {
    listAchievements.mockResolvedValue(ACHIEVEMENTS)
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Achievements')).toBeInTheDocument())
    // Three most recent unlocks by unlocked_at:
    expect(screen.getByText('Three Chords, Three Humans')).toBeInTheDocument()
    expect(screen.getByText('Calendar Rock')).toBeInTheDocument()
    expect(screen.getByText('Now We’re Photogenic')).toBeInTheDocument()
    // Older unlocks and locked achievements stay off the card:
    expect(screen.queryByText('Welcome to the Giggle')).not.toBeInTheDocument()
    expect(screen.queryByText('First Rehearsal, Last Excuse')).not.toBeInTheDocument()
    expect(screen.queryByText('Tour Bus Not Included')).not.toBeInTheDocument()
    const showAll = screen.getByRole('link', { name: /show all/i })
    expect(showAll).toHaveAttribute('href', '/achievements')
  })

  it('shows the achievements empty state when nothing is unlocked', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Achievements')).toBeInTheDocument())
    expect(screen.getByText('No achievements unlocked yet')).toBeInTheDocument()
  })

  it('renders the memory tile image, caption and linked past gig (read-only)', async () => {
    getProfile.mockResolvedValue({
      logo_path: null,
      memory_image_path: 'tenants/1/memory/x.png',
      memory_caption: 'Best night ever',
      memory_gig_id: 1,
    })
    const { container } = wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Best night ever')).toBeInTheDocument())
    expect(container.querySelector('img[src="/api/files/tenants/1/memory/x.png"]')).not.toBeNull()
    // The linked past gig shows as a chip; the same gig is excluded from upcoming shows.
    expect(screen.getByText(/Past Show/)).toBeInTheDocument()
    // A non-writer sees no edit affordance.
    expect(screen.queryByRole('button', { name: /edit memory/i })).not.toBeInTheDocument()
  })

  it('does not render the memory tile for a read-only member with no memory set', async () => {
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Jazz Night')).toBeInTheDocument())
    expect(screen.queryByText('Memory')).not.toBeInTheDocument()
  })

  it('lets an editor add a caption, persisting it via updateProfile', async () => {
    useAuth.mockReturnValue({ user: { id: 1, bandMemberId: 7, isSuperAdmin: true } })
    updateProfile.mockResolvedValue({})
    const user = userEvent.setup()
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Memory')).toBeInTheDocument())
    // Empty + editable: the add-photo affordance is offered.
    expect(screen.getByRole('button', { name: /add photo/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /edit memory/i }))
    const field = screen.getByLabelText('Caption')
    await user.type(field, 'Hello')
    await user.tab() // blur flushes the debounced save immediately
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ memory_caption: 'Hello' }))
  })

  it('searches gigs remotely after three characters without loading the full gig list', async () => {
    useAuth.mockReturnValue({ user: { id: 1, bandMemberId: 7, isSuperAdmin: true } })
    searchGigs.mockResolvedValue([GIGS[0]])
    getGig.mockResolvedValue({ ...GIGS[0], event_description: 'Canonical Past Show' })
    const user = userEvent.setup()
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText('Memory')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /edit memory/i }))
    const field = screen.getByLabelText('Link a past gig')
    await user.type(field, 'Pa')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(searchGigs).not.toHaveBeenCalled()

    await user.type(field, 's')
    await waitFor(() => expect(searchGigs).toHaveBeenCalledWith('Pas'))
    await user.click(await screen.findByText(/Past Show/))

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ memory_gig_id: 1 }))
    await waitFor(() => expect(getGig).toHaveBeenCalledWith(1))
    expect(updateProfile.mock.invocationCallOrder[0]).toBeLessThan(getGig.mock.invocationCallOrder[0])
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(field.value).toContain('Canonical Past Show')
    expect(listGigs).not.toHaveBeenCalled()
  })

  it('does not search when an existing linked gig resets the picker input to its label', async () => {
    useAuth.mockReturnValue({ user: { id: 1, bandMemberId: 7, isSuperAdmin: true } })
    getProfile.mockResolvedValue({
      logo_path: null,
      memory_image_path: 'tenants/1/memory/x.png',
      memory_gig_id: 1,
    })
    const user = userEvent.setup()
    wrap(<DashboardPage />)
    await waitFor(() => expect(screen.getByText(/Past Show/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /edit memory/i }))
    await waitFor(() => expect(screen.getByLabelText('Link a past gig').value).toContain('Past Show'))
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(searchGigs).not.toHaveBeenCalled()
    expect(listGigs).not.toHaveBeenCalled()
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
