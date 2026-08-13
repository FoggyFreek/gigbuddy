import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MyBandSelect from '../components/MyBandSelect.tsx'
import theme from '../../../theme.ts'

vi.mock('../myBands.ts', () => ({ listMyBands: vi.fn() }))

import { listMyBands } from '../myBands.ts'
import { AuthContext } from '../../../contexts/authContext.ts'

const band = (id, name) => ({
  id,
  bandProfile: { id: id * 10, name, country_code: 'NL' },
  eventCounts: { gigs: 0, rehearsals: 0, bandEvents: 0 },
  addedAt: '2026-01-01',
})

const BANDS = [band(4, 'Other Band'), band(5, 'Nirvana')]

function wrap(ui, kind = 'personal') {
  return render(
    <AuthContext.Provider
      value={{
        user: { id: 9, activeTenantId: 1, activeTenantKind: kind, permissions: ['app.view'] },
        setUser: () => {},
        logout: async () => {},
        switchTenant: async () => undefined,
        refreshUser: async () => undefined,
      }}
    >
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </AuthContext.Provider>
  )
}

describe('MyBandSelect', () => {
  beforeEach(() => {
    listMyBands.mockReset()
    listMyBands.mockResolvedValue({ items: BANDS })
  })

  it('renders the picker in a personal workspace', async () => {
    wrap(<MyBandSelect value={4} onChange={() => {}} />)
    expect(await screen.findByRole('combobox', { name: 'Band' })).toBeInTheDocument()
    expect(screen.getByText('Other Band')).toBeInTheDocument()
  })

  it('renders nothing in a band workspace and fetches no collection', async () => {
    wrap(<MyBandSelect value={null} onChange={() => {}} />, 'band')
    await waitFor(() => expect(listMyBands).not.toHaveBeenCalled())
    expect(screen.queryByRole('combobox', { name: 'Band' })).not.toBeInTheDocument()
  })

  it('renders nothing when the collection is empty', async () => {
    listMyBands.mockResolvedValue({ items: [] })
    wrap(<MyBandSelect value={null} onChange={() => {}} />)
    await waitFor(() => expect(listMyBands).toHaveBeenCalled())
    expect(screen.queryByRole('combobox', { name: 'Band' })).not.toBeInTheDocument()
  })
})

// Detail views label the event with the same two-letter avatar the overviews use,
// centered above the picker.
describe('MyBandSelect — withAvatar', () => {
  beforeEach(() => {
    listMyBands.mockReset()
    listMyBands.mockResolvedValue({ items: BANDS })
  })

  it("shows the initials of the selected band's first two words", async () => {
    wrap(<MyBandSelect withAvatar value={4} onChange={() => {}} />)
    const identity = await screen.findByTestId('my-band-identity')
    expect(identity).toHaveTextContent('OB')
    expect(screen.getByRole('combobox', { name: 'Band' })).toBeInTheDocument()
  })

  it('shows the first two letters of a single-word band name', async () => {
    wrap(<MyBandSelect withAvatar value={5} onChange={() => {}} />)
    expect(await screen.findByLabelText('Nirvana')).toHaveTextContent('NI')
  })

  it('matches a band id that arrives as a string', async () => {
    wrap(<MyBandSelect withAvatar value="4" onChange={() => {}} />)
    expect(await screen.findByLabelText('Other Band')).toHaveTextContent('OB')
  })

  it('shows a placeholder avatar when no band is linked', async () => {
    wrap(<MyBandSelect withAvatar value={null} onChange={() => {}} />)
    expect(await screen.findByTestId('my-band-identity')).toHaveTextContent('—')
  })

  it('renders nothing when the collection is empty, avatar included', async () => {
    listMyBands.mockResolvedValue({ items: [] })
    wrap(<MyBandSelect withAvatar value={null} onChange={() => {}} />)
    await waitFor(() => expect(listMyBands).toHaveBeenCalled())
    expect(screen.queryByTestId('my-band-identity')).not.toBeInTheDocument()
  })
})
