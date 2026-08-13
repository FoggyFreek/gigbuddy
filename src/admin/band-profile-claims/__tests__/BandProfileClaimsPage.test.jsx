import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../../../theme.ts'
import BandProfileClaimsPage from '../BandProfileClaimsPage.tsx'
import { ThemeModeContext } from '../../../contexts/themeModeContext.ts'
import { CompactLayoutContext } from '../../../hooks/useCompactLayout.ts'

vi.mock('../bandProfileClaims.ts', () => ({
  listClaimQueue: vi.fn(),
  listUnclaimedProfiles: vi.fn(),
  deleteUnclaimedProfile: vi.fn(),
  approveClaim: vi.fn(),
  rejectClaim: vi.fn(),
}))

import {
  listClaimQueue,
  listUnclaimedProfiles,
  deleteUnclaimedProfile,
} from '../bandProfileClaims.ts'

const unclaimedPage = (items) => ({
  items,
  meta: { limit: 25, returned: items.length, total: items.length, nextCursor: null },
})

const unclaimedProfile = (over = {}) => ({
  id: 5001,
  name: 'Off Platform',
  memberCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const wrap = () => render(
  <ThemeModeContext.Provider value={{ mode: 'light', toggleTheme: vi.fn(), variant: 'default', setVariant: vi.fn() }}>
    <CompactLayoutContext.Provider value={false}>
      <ThemeProvider theme={theme}>
        <MemoryRouter><BandProfileClaimsPage /></MemoryRouter>
      </ThemeProvider>
    </CompactLayoutContext.Provider>
  </ThemeModeContext.Provider>,
)

// The tab is not the landing tab, so every test starts by switching to it.
async function openUnclaimedTab(user) {
  await user.click(screen.getByRole('tab', { name: 'Unclaimed' }))
  return screen.findByRole('table', { name: 'Unclaimed band profiles' })
}

describe('BandProfileClaimsPage — unclaimed profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listClaimQueue.mockResolvedValue({ items: [], meta: { limit: 20, nextCursor: null } })
    listUnclaimedProfiles.mockResolvedValue(unclaimedPage([unclaimedProfile()]))
  })

  it('spells out the cost before deleting, and does nothing on cancel', async () => {
    const user = userEvent.setup()
    wrap()
    await openUnclaimedTab(user)

    await user.click(screen.getByRole('button', { name: 'Delete Off Platform' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/2 musicians have this band in My Bands/)).toBeInTheDocument()
    expect(within(dialog).getByText(/The events themselves are kept/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(deleteUnclaimedProfile).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('deletes on confirmation and reloads the list', async () => {
    const user = userEvent.setup()
    deleteUnclaimedProfile.mockResolvedValue(null)
    listUnclaimedProfiles
      .mockResolvedValueOnce(unclaimedPage([unclaimedProfile()]))
      .mockResolvedValueOnce(unclaimedPage([]))
    wrap()
    await openUnclaimedTab(user)

    await user.click(screen.getByRole('button', { name: 'Delete Off Platform' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteUnclaimedProfile).toHaveBeenCalledWith(5001))
    expect(await screen.findByText('No unclaimed band profiles.')).toBeInTheDocument()
    expect(listUnclaimedProfiles).toHaveBeenCalledTimes(2)
  })

  it('keeps the dialog open and shows why the backend refused', async () => {
    const user = userEvent.setup()
    deleteUnclaimedProfile.mockRejectedValue(new Error('Decide the pending claim on this profile first'))
    wrap()
    await openUnclaimedTab(user)

    await user.click(screen.getByRole('button', { name: 'Delete Off Platform' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByText('Decide the pending claim on this profile first'))
      .toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('says so plainly when nobody holds the profile', async () => {
    const user = userEvent.setup()
    listUnclaimedProfiles.mockResolvedValue(unclaimedPage([unclaimedProfile({ memberCount: 0 })]))
    wrap()
    await openUnclaimedTab(user)

    await user.click(screen.getByRole('button', { name: 'Delete Off Platform' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Nobody has this band in My Bands.')).toBeInTheDocument()
  })
})
