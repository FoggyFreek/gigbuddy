import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GigDetailContent from '../components/GigDetailContent.tsx'
import theme from '../theme.ts'

vi.mock('../api/availability.ts', () => ({
  getAvailabilityOn: vi.fn().mockResolvedValue({ bandWide: null, members: [] }),
  listAvailability: vi.fn().mockResolvedValue([]),
  createSlot: vi.fn(),
  updateSlot: vi.fn(),
  deleteSlot: vi.fn(),
}))

vi.mock('../api/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))

vi.mock('../api/gigs.ts', () => ({
  getGig: vi.fn().mockResolvedValue({
    id: 1,
    event_date: '2026-06-15',
    event_description: 'Jazz Night',
    venue: { id: 11, name: 'Bimhuis', category: 'venue', city: 'Amsterdam' },
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
  listGigContacts: vi.fn().mockResolvedValue([]),
  addGigContact: vi.fn().mockResolvedValue({}),
  setGigContactPrimary: vi.fn().mockResolvedValue({}),
  removeGigContact: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../api/venues.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  listVenueContacts: vi.fn().mockResolvedValue([]),
}))

import { getGig, updateGig } from '../api/gigs.ts'

const GIG_PAID = {
  id: 1,
  event_date: '2026-06-15',
  event_description: 'Jazz Night',
  venue: { id: 11, name: 'Bimhuis', category: 'venue', city: 'Amsterdam' },
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
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
      </ThemeProvider>
    </MemoryRouter>
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
    expect(screen.getByDisplayValue('Bimhuis — Amsterdam')).toBeInTheDocument()
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

describe('GigDetailContent — reader mode (canWrite=false)', () => {
  beforeEach(() => {
    getGig.mockClear()
    updateGig.mockClear()
  })

  it('disables the editable fields', async () => {
    wrap(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => expect(screen.getByDisplayValue('Jazz Night')).toBeInTheDocument())
    expect(screen.getByLabelText(/event description/i)).toBeDisabled()
    expect(screen.getByLabelText(/paid admission/i)).toBeDisabled()
    expect(screen.getByLabelText(/band fee/i)).toBeDisabled()
    expect(screen.getByLabelText(/notes/i)).toBeDisabled()
  })

  it('hides the banner upload control', async () => {
    wrap(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    expect(screen.queryByRole('button', { name: /upload banner/i })).not.toBeInTheDocument()
  })

  it('does not auto-save when a disabled control is clicked', async () => {
    // pointerEventsCheck:0 lets us drive the click through the disabled control;
    // because the input is disabled its onChange never fires, so nothing saves.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    wrap(<GigDetailContent gigId={1} canWrite={false} />)
    await waitFor(() => screen.getByLabelText(/paid admission/i))
    await user.click(screen.getByLabelText(/paid admission/i))
    expect(updateGig).not.toHaveBeenCalled()
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
