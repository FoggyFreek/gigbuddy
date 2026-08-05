import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import MyAvailabilitySection from '../components/settings/MyAvailabilitySection.tsx'
import { getAvailabilitySettings, updateAvailabilitySettings } from '../api/userAvailability.ts'

vi.mock('../api/userAvailability.ts', () => ({
  getAvailabilitySettings: vi.fn(),
  updateAvailabilitySettings: vi.fn(),
}))

const SETTINGS = {
  availabilityDetailVisible: false,
  crossBandGigDetailVisible: false,
  delegations: [
    { tenantId: 1, displayName: 'Band A', managedByBand: false },
    { tenantId: 2, displayName: 'Band B', managedByBand: true },
  ],
}

function wrap() {
  return render(
    <ThemeProvider theme={theme}>
      <MyAvailabilitySection />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getAvailabilitySettings.mockResolvedValue(SETTINGS)
  updateAvailabilitySettings.mockImplementation((patch) =>
    Promise.resolve({ ...SETTINGS, ...patch }))
})

describe('MyAvailabilitySection', () => {
  // Private by default: sharing is something the musician turns on.
  it('shows both detail flags off by default', async () => {
    wrap()
    const detail = await screen.findByRole('switch', { name: /why I'm unavailable/i })
    const crossBand = screen.getByRole('switch', { name: /booked for elsewhere/i })
    expect(detail).not.toBeChecked()
    expect(crossBand).not.toBeChecked()
  })

  it('turns detail sharing on', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('switch', { name: /why I'm unavailable/i }))
    await waitFor(() => expect(updateAvailabilitySettings).toHaveBeenCalledWith({
      availability_detail_visible: true,
    }))
  })

  it('turns cross-band detail on separately', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('switch', { name: /booked for elsewhere/i }))
    await waitFor(() => expect(updateAvailabilitySettings).toHaveBeenCalledWith({
      cross_band_gig_detail_visible: true,
    }))
  })

  it('lists one delegation row per band, reflecting its current state', async () => {
    wrap()
    expect(await screen.findByRole('switch', { name: /Band A may manage/i })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: /Band B may manage/i })).toBeChecked()
  })

  // Delegation is per band: toggling one names only that tenant.
  it('delegates to a single named band', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('switch', { name: /Band A may manage/i }))
    await waitFor(() => expect(updateAvailabilitySettings).toHaveBeenCalledWith({
      delegations: [{ tenantId: 1, managedByBand: true }],
    }))
  })

  it('reports a failed save', async () => {
    updateAvailabilitySettings.mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('switch', { name: /why I'm unavailable/i }))
    expect(await screen.findByText('Could not save your availability settings.')).toBeInTheDocument()
  })

  it('says so when the musician is in no band', async () => {
    getAvailabilitySettings.mockResolvedValue({ ...SETTINGS, delegations: [] })
    wrap()
    expect(await screen.findByText("You're not in any band yet.")).toBeInTheDocument()
  })
})
