import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RehearsalDetailPage from '../RehearsalDetailPage.tsx'
import theme from '../../../theme.ts'

vi.mock('../rehearsals.ts', () => ({
  getRehearsal: vi.fn(),
  updateRehearsal: vi.fn().mockResolvedValue({}),
  deleteRehearsal: vi.fn().mockResolvedValue(undefined),
  addParticipant: vi.fn().mockResolvedValue({}),
  removeParticipant: vi.fn().mockResolvedValue(null),
  addSong: vi.fn().mockResolvedValue({}),
  removeSong: vi.fn().mockResolvedValue(undefined),
  setVote: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../availability/me.ts', () => ({
  getMyRehearsal: vi.fn(),
  setMyRehearsalVote: vi.fn().mockResolvedValue({}),
}))

vi.mock('../../availability/availability.ts', () => ({
  evaluateEventAvailability: vi.fn().mockResolvedValue({ members: [], bandWide: null }),
}))

vi.mock('../../../people/memberships/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../music/songs/songs.ts', () => ({
  searchSongs: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../people/my-bands/myBands.ts', () => ({
  listMyBands: vi.fn().mockResolvedValue({ items: [] }),
}))

import { getRehearsal, updateRehearsal } from '../rehearsals.ts'
import { getMyRehearsal } from '../../availability/me.ts'
import { listMembers } from '../../../people/memberships/bandMembers.ts'
import { listMyBands } from '../../../people/my-bands/myBands.ts'
import { AuthContext } from '../../../contexts/authContext.ts'

const REHEARSAL = {
  id: 3,
  proposed_date: '2026-09-04',
  start_time: '19:00:00',
  end_time: '22:00:00',
  location: 'Studio 5',
  notes: '',
  status: 'planned',
  participants: [],
  songs: [],
}

const MY_BANDS = [
  { id: 4, bandProfile: { id: 40, name: 'Static Waves', country_code: 'NL' }, eventCounts: {}, addedAt: '2026-01-01' },
  { id: 5, bandProfile: { id: 50, name: 'Nirvana', country_code: 'US' }, eventCounts: {}, addedAt: '2026-01-01' },
]

function wrap(user) {
  return render(
    <MemoryRouter initialEntries={['/rehearsals/3']}>
      <AuthContext.Provider
        value={{
          user,
          setUser: () => {},
          logout: async () => {},
          switchTenant: async () => undefined,
          refreshUser: async () => undefined,
        }}
      >
        <ThemeProvider theme={theme}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <Routes>
              <Route path="/rehearsals/:id" element={<RehearsalDetailPage />} />
            </Routes>
          </LocalizationProvider>
        </ThemeProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

const BAND_USER = {
  id: 9,
  activeTenantId: 1,
  activeTenantRole: 'tenant_admin',
  permissions: ['app.view', 'planning.write'],
  bandMemberId: 3,
}

const ARTIST_USER = { ...BAND_USER, activeTenantKind: 'personal', bandMemberId: null }

// In a personal workspace a rehearsal is labelled with the band profile it was
// for, in the slot a gigbuddy band's rehearsal gives the band switcher.
describe('RehearsalDetailPage — my band identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRehearsal.mockResolvedValue(REHEARSAL)
    getMyRehearsal.mockResolvedValue({
      ...REHEARSAL,
      tenantId: 1,
      tenantName: 'Solo',
      my_band: { id: 4, name: 'Static Waves', country_code: 'NL' },
    })
    listMembers.mockResolvedValue([])
    listMyBands.mockResolvedValue({ items: MY_BANDS })
    updateRehearsal.mockResolvedValue({})
  })

  it('shows the linked band above the rehearsal fields', async () => {
    wrap(ARTIST_USER)
    await waitFor(() => expect(screen.getByDisplayValue('Studio 5')).toBeInTheDocument())

    const identity = await screen.findByTestId('my-band-identity')
    expect(identity).toHaveTextContent('SW')
    expect(screen.getByRole('combobox', { name: 'Band' })).toHaveTextContent('Static Waves')

    const location = screen.getByDisplayValue('Studio 5')
    expect(identity.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('relinks the rehearsal to another band and re-reads it', async () => {
    const user = userEvent.setup()
    wrap(ARTIST_USER)
    await waitFor(() => expect(screen.getByDisplayValue('Studio 5')).toBeInTheDocument())

    await user.click(await screen.findByRole('combobox', { name: 'Band' }))
    await user.click(screen.getByRole('option', { name: 'Nirvana' }))

    await waitFor(() => expect(updateRehearsal).toHaveBeenCalledWith(3, { my_band_id: 5 }))
    await waitFor(() => expect(getMyRehearsal.mock.calls.length).toBeGreaterThan(1))
  })

  it("shows the band switcher, not the picker, for another band's rehearsal", async () => {
    getMyRehearsal.mockResolvedValue({
      ...REHEARSAL,
      tenantId: 9,
      tenantName: 'Other Band',
      tenantAvatarPath: null,
    })
    wrap(ARTIST_USER)
    await waitFor(() => expect(screen.getByDisplayValue('Studio 5')).toBeInTheDocument())

    expect(screen.getByTestId('source-tenant-switch')).toBeInTheDocument()
    expect(screen.queryByTestId('my-band-identity')).not.toBeInTheDocument()
  })

  it('shows no picker in a band workspace and fetches no collection', async () => {
    wrap(BAND_USER)
    await waitFor(() => expect(screen.getByDisplayValue('Studio 5')).toBeInTheDocument())

    expect(screen.queryByTestId('my-band-identity')).not.toBeInTheDocument()
    expect(listMyBands).not.toHaveBeenCalled()
    expect(getMyRehearsal).not.toHaveBeenCalled()
  })
})
