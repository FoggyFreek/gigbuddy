import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../hooks/useGigMapData.ts', () => ({ useGigMapData: vi.fn() }))
// Stub Leaflet so the real GigWorldMap renders its markers/popups in jsdom without
// actually booting a map. Popup/Marker pass children straight through so the
// per-gig links render and we can assert them.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }) => <div>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  useMap: () => ({ fitBounds: vi.fn() }),
}))
vi.mock('leaflet', () => ({
  default: { divIcon: vi.fn(() => ({})), latLngBounds: vi.fn(() => ({})) },
}))

import GigMapPage from '../pages/GigMapPage.tsx'
import { useGigMapData } from '../hooks/useGigMapData.ts'
import theme from '../theme.ts'

function wrap() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <GigMapPage />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('GigMapPage', () => {
  it('shows a spinner while loading', () => {
    useGigMapData.mockReturnValue({ status: 'ok', loading: true, cityCount: 0, gigCount: 0, markers: [] })
    wrap()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('renders a summary and a popup link per gig', () => {
    useGigMapData.mockReturnValue({
      status: 'ok',
      loading: false,
      cityCount: 1,
      gigCount: 1,
      markers: [
        {
          key: 'utrecht',
          lat: 52.09,
          lon: 5.12,
          label: 'Utrecht, NL',
          gigs: [{ id: 1, event_date: '2026-01-10', event_description: 'Past Show' }],
        },
      ],
    })

    wrap()

    expect(screen.getByText(/1 gig across 1 city/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Past Show/ })
    expect(link).toHaveAttribute('href', '/gigs/1')
  })

  it('shows an error when the gig map data cannot load', () => {
    useGigMapData.mockReturnValue({ status: 'error', loading: false, cityCount: 0, gigCount: 0, markers: [] })
    wrap()

    expect(screen.getByText(/couldn't load the gig map/i)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})
