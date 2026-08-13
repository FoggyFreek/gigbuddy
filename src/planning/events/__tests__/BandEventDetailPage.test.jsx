import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BandEventDetailPage from '../BandEventDetailPage.tsx'
import theme from '../../../theme.ts'

vi.mock('../bandEvents.ts', () => ({
  getBandEvent: vi.fn(),
  updateBandEvent: vi.fn().mockResolvedValue({}),
  deleteBandEvent: vi.fn().mockResolvedValue(undefined),
  addBandEventParticipant: vi.fn().mockResolvedValue({}),
  removeBandEventParticipant: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../availability/me.ts', () => ({
  getMyBandEvent: vi.fn(),
}))

vi.mock('../../../people/memberships/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../people/my-bands/myBands.ts', () => ({
  listMyBands: vi.fn().mockResolvedValue({ items: [] }),
}))

import { getBandEvent, updateBandEvent } from '../bandEvents.ts'
import { getMyBandEvent } from '../../availability/me.ts'
import { listMembers } from '../../../people/memberships/bandMembers.ts'
import { listMyBands } from '../../../people/my-bands/myBands.ts'
import { AuthContext } from '../../../contexts/authContext.ts'

const EVENT = {
  id: 7,
  title: 'Photo shoot',
  start_date: '2026-09-04',
  end_date: '2026-09-04',
  start_time: '10:00:00',
  end_time: '14:00:00',
  location: 'Studio 5',
  notes: '',
}

const MY_BANDS = [
  { id: 4, bandProfile: { id: 40, name: 'Static Waves', country_code: 'NL' }, eventCounts: {}, addedAt: '2026-01-01' },
  { id: 5, bandProfile: { id: 50, name: 'Nirvana', country_code: 'US' }, eventCounts: {}, addedAt: '2026-01-01' },
]

function wrap(user) {
  return render(
    <MemoryRouter initialEntries={['/band-events/7']}>
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
              <Route path="/band-events/:id" element={<BandEventDetailPage />} />
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

describe('BandEventDetailPage — my band identity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBandEvent.mockResolvedValue(EVENT)
    getMyBandEvent.mockResolvedValue({
      ...EVENT,
      tenantId: 1,
      tenantName: 'Solo',
      my_band: { id: 4, name: 'Static Waves', country_code: 'NL' },
    })
    listMembers.mockResolvedValue([])
    listMyBands.mockResolvedValue({ items: MY_BANDS })
    updateBandEvent.mockResolvedValue({})
  })

  it('shows the linked band above the event fields', async () => {
    wrap(ARTIST_USER)
    await waitFor(() => expect(screen.getByDisplayValue('Photo shoot')).toBeInTheDocument())

    const identity = await screen.findByTestId('my-band-identity')
    expect(identity).toHaveTextContent('SW')
    expect(screen.getByRole('combobox', { name: 'Band' })).toHaveTextContent('Static Waves')

    const title = screen.getByDisplayValue('Photo shoot')
    expect(identity.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('relinks the event to another band and re-reads it', async () => {
    const user = userEvent.setup()
    wrap(ARTIST_USER)
    await waitFor(() => expect(screen.getByDisplayValue('Photo shoot')).toBeInTheDocument())

    await user.click(await screen.findByRole('combobox', { name: 'Band' }))
    await user.click(screen.getByRole('option', { name: 'Nirvana' }))

    await waitFor(() => expect(updateBandEvent).toHaveBeenCalledWith(7, { my_band_id: 5 }))
    await waitFor(() => expect(getMyBandEvent.mock.calls.length).toBeGreaterThan(1))
  })

  it("shows the band switcher, not the picker, for another band's event", async () => {
    getMyBandEvent.mockResolvedValue({
      ...EVENT,
      tenantId: 9,
      tenantName: 'Other Band',
      tenantAvatarPath: null,
    })
    wrap(ARTIST_USER)
    await waitFor(() => expect(screen.getByDisplayValue('Photo shoot')).toBeInTheDocument())

    expect(screen.getByTestId('source-tenant-switch')).toBeInTheDocument()
    expect(screen.queryByTestId('my-band-identity')).not.toBeInTheDocument()
  })

  it('shows no picker in a band workspace and fetches no collection', async () => {
    wrap(BAND_USER)
    await waitFor(() => expect(screen.getByDisplayValue('Photo shoot')).toBeInTheDocument())

    expect(screen.queryByTestId('my-band-identity')).not.toBeInTheDocument()
    expect(listMyBands).not.toHaveBeenCalled()
    expect(getMyBandEvent).not.toHaveBeenCalled()
  })
})
