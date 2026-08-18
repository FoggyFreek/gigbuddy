import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'

const invalidateSize = vi.fn()

// Stub Leaflet so the real GigLocationMap renders its marker/popup in jsdom
// without booting a map. Popup/Marker pass children through so the link renders.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }) => <div>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  useMap: () => ({ invalidateSize }),
}))
vi.mock('leaflet', () => ({
  default: { divIcon: vi.fn(() => ({})) },
}))

import GigLocationMap from '../components/map/GigLocationMap.tsx'
import theme from '../../../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

afterEach(() => vi.clearAllMocks())

describe('GigLocationMap', () => {
  const props = {
    lat: 52.37,
    lon: 4.9,
    zoom: 16,
    label: 'Bimhuis',
    openLabel: 'Open in maps',
    mapsHref: 'https://www.google.com/maps/search/?api=1&query=Amsterdam',
  }

  // Two ways out to the external map: the marker popup's link, and the overlay
  // button in the corner. Both must be labelled and safe to open in a new tab.
  it('renders the venue label and accessible external maps links', () => {
    wrap(<GigLocationMap {...props} />)

    expect(screen.getByText('Bimhuis')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'Open in maps' })
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link).toHaveAttribute('href', props.mapsHref)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    }
  })

  it('invalidates the map size on mount so it sizes correctly when revealed', () => {
    wrap(<GigLocationMap {...props} />)
    expect(invalidateSize).toHaveBeenCalled()
  })
})
