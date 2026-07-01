import { useEffect } from 'react'
import React from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// react-leaflet types are incomplete (leaflet has no bundled .d.ts) — cast the
// components to accept any props so tsc doesn't block on known-good usage.
import { MapContainer as _MapContainer, TileLayer as _TileLayer, Marker as _Marker, Popup, useMap } from 'react-leaflet'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { OSM_ATTRIBUTION, OSM_URL } from './osm.ts'

// See GigWorldMap for why these are double-cast through unknown.
type LeafletComponentProps = Record<string, unknown> & { children?: React.ReactNode }
const MapContainer = _MapContainer as unknown as React.ComponentType<LeafletComponentProps>
const TileLayer = _TileLayer as unknown as React.ComponentType<LeafletComponentProps>
const Marker = _Marker as unknown as React.ComponentType<LeafletComponentProps>

// A teardrop pin as a divIcon — sidesteps Leaflet's broken default marker image
// paths under bundlers without pulling in a plugin.
function pinIcon(color: string) {
  return L.divIcon({
    className: 'gig-location-pin',
    html:
      `<div style="width:22px;height:22px;background:${color};border:2px solid #fff;` +
      'border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
      'box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -20],
  })
}

// Leaflet mis-sizes when its container is first laid out after init (e.g. a tab
// that was hidden on mount). Recompute size once we're on screen.
function InvalidateSize() {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
  }, [map])
  return null
}

interface GigLocationMapProps {
  lat: number
  lon: number
  zoom: number
  /** Venue/festival name shown in the popup. */
  label: string
  /** Accessible link text, e.g. "Open in Maps". */
  openLabel: string
  /** External maps deep link opened in a new tab. */
  mapsHref: string
}

/**
 * Compact single-marker Leaflet map for a gig's location. Interactive
 * (pan/zoom); the marker popup carries an accessible "open in maps" link.
 * Center/zoom are init-only in Leaflet, so callers should remount this via a
 * `key` derived from lat/lon/zoom when the location changes.
 */
export default function GigLocationMap({ lat, lon, zoom, label, openLabel, mapsHref }: GigLocationMapProps) {
  const theme = useTheme()

  return (
    <Box
      sx={{
        height: 150,
        width: '100%',
        borderRadius: 1,
        overflow: 'hidden',
        '& .leaflet-container': { height: '100%', width: '100%', bgcolor: 'action.hover' },
      }}
    >
      <MapContainer
        center={[lat, lon] as [number, number]}
        zoom={zoom}
        scrollWheelZoom
        dragging
        doubleClickZoom
        zoomControl
        keyboard
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer url={OSM_URL} attribution={OSM_ATTRIBUTION} />
        <InvalidateSize />
        <Marker position={[lat, lon] as [number, number]} icon={pinIcon(theme.palette.primary.main)}>
          <Popup>
            <Stack spacing={0.5}>
              {label && (
                <Typography variant="subtitle2">{label}</Typography>
              )}
              <Link href={mapsHref} target="_blank" rel="noopener noreferrer" underline="hover" variant="body2">
                {openLabel}
              </Link>
            </Stack>
          </Popup>
        </Marker>
      </MapContainer>
    </Box>
  )
}
