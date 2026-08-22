import { useEffect } from 'react'
import React from 'react'
import 'leaflet/dist/leaflet.css'
// react-leaflet types are incomplete (leaflet has no bundled .d.ts) — cast the
// components to accept any props so tsc doesn't block on known-good usage.
import { MapContainer as _MapContainer, TileLayer as _TileLayer, Marker as _Marker, Popup, useMap } from 'react-leaflet'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import MapIcon from '@mui/icons-material/Map'
import { OSM_ATTRIBUTION, OSM_URL } from '../../../../components/map/osm.ts'
import { pinIcon } from '../../../../components/map/pinIcon.ts'

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
 * (pan/zoom); an overlay button and the marker popup both carry the "open in
 * maps" link.
 * Center/zoom are init-only in Leaflet, so callers should remount this via a
 * `key` derived from lat/lon/zoom when the location changes.
 */
export default function GigLocationMap({ lat, lon, zoom, label, openLabel, mapsHref }: GigLocationMapProps) {
  const theme = useTheme()

  return (
    <Box
      sx={{
        position: 'relative',
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

      <Tooltip title={openLabel}>
        <IconButton
          size="small"
          aria-label={openLabel}
          component="a"
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            position: 'absolute',
            // Clear of the OSM attribution strip Leaflet pins to this corner,
            // and above its panes and controls (z-index 400-800).
            bottom: 24,
            right: 8,
            zIndex: 1000,
            bgcolor: 'background.paper',
            boxShadow: 2,
            '&:hover': { bgcolor: 'background.paper' },
          }}
        >
          <MapIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
