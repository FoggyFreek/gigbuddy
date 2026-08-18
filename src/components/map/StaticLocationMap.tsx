import { useEffect } from 'react'
import React from 'react'
import 'leaflet/dist/leaflet.css'
// react-leaflet types are incomplete (leaflet has no bundled .d.ts) — cast the
// components to accept any props so tsc doesn't block on known-good usage.
import { MapContainer as _MapContainer, TileLayer as _TileLayer, Marker as _Marker, useMap } from 'react-leaflet'
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'
import { OSM_ATTRIBUTION, OSM_URL } from './osm.ts'
import { pinIcon } from './pinIcon.ts'

// See GigWorldMap for why these are double-cast through unknown.
type LeafletComponentProps = Record<string, unknown> & { children?: React.ReactNode }
const MapContainer = _MapContainer as unknown as React.ComponentType<LeafletComponentProps>
const TileLayer = _TileLayer as unknown as React.ComponentType<LeafletComponentProps>
const Marker = _Marker as unknown as React.ComponentType<LeafletComponentProps>

// Leaflet mis-sizes when its container is first laid out after init (e.g. a tab
// that was hidden on mount). Recompute size once we're on screen.
function InvalidateSize() {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
  }, [map])
  return null
}

interface StaticLocationMapProps {
  lat: number
  lon: number
  zoom: number
}

/**
 * A decorative, entirely non-interactive Leaflet map pinned on one location: no
 * dragging, zooming, keyboard focus or pointer events at all, so it reads as a
 * backdrop rather than a control. The OSM attribution stays clickable — tile
 * usage requires it.
 *
 * Fills its nearest positioned ancestor and owns its own stacking context
 * (`zIndex: 0`), so overlay siblings need only `position: relative` and a
 * `zIndex: 1` to sit above Leaflet's internal panes.
 *
 * Center/zoom are init-only in Leaflet, so callers remount this via a `key`
 * derived from lat/lon/zoom when the location changes.
 */
export default function StaticLocationMap({ lat, lon, zoom }: Readonly<StaticLocationMapProps>) {
  const theme = useTheme()

  return (
    <Box
      aria-hidden
      data-testid="static-location-map"
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        '& .leaflet-container': { height: '100%', width: '100%', bgcolor: 'action.hover' },
        // The map is scenery: clicks land on the page, not on Leaflet. The
        // attribution opts itself back in (OSM licensing).
        '& .leaflet-pane, & .leaflet-control-container': { pointerEvents: 'none' },
        '& .leaflet-control-attribution': { pointerEvents: 'auto' },
      }}
    >
      <MapContainer
        center={[lat, lon] as [number, number]}
        zoom={zoom}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        zoomControl={false}
        keyboard={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer url={OSM_URL} attribution={OSM_ATTRIBUTION} />
        <InvalidateSize />
        <Marker position={[lat, lon] as [number, number]} icon={pinIcon(theme.palette.primary.main)} />
      </MapContainer>
    </Box>
  )
}
