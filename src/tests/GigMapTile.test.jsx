import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../hooks/useGigMapData.ts', () => ({ useGigMapData: vi.fn() }))
// Stub the (lazy-loaded) map so jsdom never runs Leaflet.
vi.mock('../components/map/GigWorldMap.tsx', () => ({
  default: ({ markers }) => <div data-testid="world-map">map:{markers.length}</div>,
}))

import GigMapTile from '../components/dashboard/GigMapTile.tsx'
import { useGigMapData } from '../hooks/useGigMapData.ts'
import theme from '../theme.ts'

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/" element={<GigMapTile />} />
          <Route path="/map" element={<div>map-page</div>} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('GigMapTile', () => {
  it('renders the city count and the map preview', async () => {
    useGigMapData.mockReturnValue({
      status: 'ok',
      loading: false,
      cityCount: 3,
      gigCount: 5,
      markers: [{ key: 'a', lat: 1, lon: 2, label: 'Utrecht', gigs: [{ id: 1 }] }],
    })

    wrap()

    expect(await screen.findByTestId('world-map')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows the empty state when there are no past gigs', () => {
    useGigMapData.mockReturnValue({
      status: 'ok',
      loading: false,
      cityCount: 0,
      gigCount: 0,
      markers: [],
    })

    wrap()

    expect(screen.getByText('No past gigs yet')).toBeInTheDocument()
    expect(screen.queryByTestId('world-map')).not.toBeInTheDocument()
  })

  it('surfaces the error state when the gig load fails', () => {
    useGigMapData.mockReturnValue({
      status: 'error',
      loading: false,
      cityCount: 0,
      gigCount: 0,
      markers: [],
    })

    wrap()

    expect(screen.getByText(/couldn/i)).toBeInTheDocument()
    expect(screen.queryByTestId('world-map')).not.toBeInTheDocument()
  })

  it('navigates to the full map page when the preview is clicked', async () => {
    useGigMapData.mockReturnValue({
      status: 'ok',
      loading: false,
      cityCount: 1,
      gigCount: 1,
      markers: [{ key: 'a', lat: 1, lon: 2, label: 'Utrecht', gigs: [{ id: 1 }] }],
    })

    wrap()
    await userEvent.click(await screen.findByTestId('world-map'))

    await waitFor(() => expect(screen.getByText('map-page')).toBeInTheDocument())
  })
})
