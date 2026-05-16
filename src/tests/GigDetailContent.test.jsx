import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GigDetailContent from '../components/GigDetailContent.jsx'
import theme from '../theme.js'

vi.mock('../api/availability.js', () => ({
  getAvailabilityOn: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
}))

vi.mock('../api/bandMembers.js', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))

vi.mock('../api/gigs.js', () => ({
  getGig: vi.fn().mockResolvedValue({
    id: 1,
    event_date: '2026-06-15',
    event_description: 'Jazz Night',
    venue: 'Bimhuis',
    city: 'Amsterdam',
    event_link: '',
    start_time: '20:00:00',
    end_time: '23:00:00',
    status: 'option',
    booking_fee_cents: 15000,
    admission: 'free',
    ticket_link: null,
    notes: 'Bring own PA',
    has_pa_system: false,
    has_drumkit: false,
    has_stage_lights: false,
    tasks: [],
    attachments: [],
    participants: [],
  }),
  updateGig: vi.fn().mockResolvedValue({}),
  addGigParticipant: vi.fn().mockResolvedValue({}),
  removeGigParticipant: vi.fn().mockResolvedValue({}),
  setGigVote: vi.fn().mockResolvedValue({}),
  uploadGigBanner: vi.fn().mockResolvedValue({ banner_path: 'test/banner.jpg' }),
  deleteGigBanner: vi.fn().mockResolvedValue({}),
}))

import { getGig, updateGig } from '../api/gigs.js'

const GIG_PAID = {
  id: 1,
  event_date: '2026-06-15',
  event_description: 'Jazz Night',
  venue: 'Bimhuis',
  city: 'Amsterdam',
  event_link: '',
  start_time: '20:00:00',
  end_time: '23:00:00',
  status: 'option',
  booking_fee_cents: 15000,
  admission: 'paid',
  ticket_link: 'https://tickets.example.com',
  notes: '',
  has_pa_system: false,
  has_drumkit: false,
  has_stage_lights: false,
  tasks: [],
  attachments: [],
  participants: [],
}

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
    </ThemeProvider>
  )
}

describe('GigDetailContent — field rendering', () => {
  beforeEach(() => {
    getGig.mockClear()
    updateGig.mockClear()
  })

  it('loads and displays gig data', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Bimhuis')).toBeInTheDocument()
  })

  it('renders the Paid admission switch', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.getByLabelText(/paid admission/i)).toBeInTheDocument()
  })

  it('switch is unchecked by default when admission is free', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.getByLabelText(/paid admission/i)).not.toBeChecked()
  })

  it('does not show ticket link field when admission is free', async () => {
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.queryByLabelText(/ticket link/i)).not.toBeInTheDocument()
  })

  it('loads with switch checked and ticket link populated when gig has admission=paid', async () => {
    getGig.mockResolvedValueOnce(GIG_PAID)
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => expect(screen.getByLabelText(/paid admission/i)).toBeChecked())
    expect(screen.getByDisplayValue('https://tickets.example.com')).toBeInTheDocument()
  })

  it('renders Band fee and Ticket link on the same row when admission=paid', async () => {
    getGig.mockResolvedValueOnce(GIG_PAID)
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    expect(screen.getByLabelText(/band fee/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/ticket link/i)).toBeInTheDocument()
  })
})

describe('GigDetailContent — admission toggle', () => {
  beforeEach(() => {
    getGig.mockClear()
    updateGig.mockClear()
  })

  it('shows ticket link field after toggling to paid', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await user.click(screen.getByLabelText(/paid admission/i))
    expect(screen.getByLabelText(/ticket link/i)).toBeInTheDocument()
  })

  it('auto-saves admission=paid when toggled on', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await user.click(screen.getByLabelText(/paid admission/i))
    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { admission: 'paid' }),
      { timeout: 2000 }
    )
  })

  it('hides ticket link field after toggling back to free', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await user.click(screen.getByLabelText(/paid admission/i))
    expect(screen.getByLabelText(/ticket link/i)).toBeInTheDocument()
    await user.click(screen.getByLabelText(/paid admission/i))
    expect(screen.queryByLabelText(/ticket link/i)).not.toBeInTheDocument()
  })

  it('auto-saves admission=free and ticket_link=null when toggled off', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await user.click(screen.getByLabelText(/paid admission/i))
    await user.click(screen.getByLabelText(/paid admission/i))
    await waitFor(
      () => expect(updateGig).toHaveBeenCalledWith(1, { admission: 'free', ticket_link: null }),
      { timeout: 2000 }
    )
  })
})

describe('GigDetailContent — ticket link field', () => {
  beforeEach(() => {
    getGig.mockClear()
    updateGig.mockClear()
  })

  it('auto-saves ticket_link when typed', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await user.click(screen.getByLabelText(/paid admission/i))
    await user.type(screen.getByLabelText(/ticket link/i), 'https://tickets.test')
    await waitFor(
      () =>
        expect(updateGig).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ ticket_link: 'https://tickets.test' })
        ),
      { timeout: 2000 }
    )
  })

  it('shows open-link anchor when ticket_link has a value', async () => {
    getGig.mockResolvedValueOnce(GIG_PAID)
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/ticket link/i))
    const links = screen.getAllByRole('link')
    expect(links.some((l) => l.getAttribute('href') === GIG_PAID.ticket_link)).toBe(true)
  })

  it('does not show open-link anchor when ticket_link is empty', async () => {
    const user = userEvent.setup()
    wrap(<GigDetailContent gigId={1} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await user.click(screen.getByLabelText(/paid admission/i))
    // ticket_link is empty — no anchor with a ticket URL should exist
    const links = screen.queryAllByRole('link')
    expect(links.every((l) => !l.getAttribute('href')?.startsWith('https://'))).toBe(true)
  })
})
