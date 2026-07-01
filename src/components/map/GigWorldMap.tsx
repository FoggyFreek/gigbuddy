import { useEffect } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// react-leaflet types are incomplete (leaflet has no bundled .d.ts) — cast
// the components to accept any props so tsc doesn't block on known-good usage.
import { MapContainer as _MapContainer, TileLayer as _TileLayer, Marker as _Marker, Popup, useMap } from 'react-leaflet'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import React from 'react'
import { formatShortDate } from '../../utils/dateFormat.ts'
import { OSM_ATTRIBUTION, OSM_URL } from './osm.ts'
import type { MapMarker } from '../../hooks/useGigMapData.ts'

// leaflet has no bundled .d.ts; react-leaflet's types inherit MapOptions from
// unresolved leaflet types so fields like center/icon/attribution are missing.
// Double-cast via unknown to a permissive type so known-good usage compiles.
type LeafletComponentProps = Record<string, unknown> & { children?: React.ReactNode }
const MapContainer = _MapContainer as unknown as React.ComponentType<LeafletComponentProps>
const TileLayer = _TileLayer as unknown as React.ComponentType<LeafletComponentProps>
const Marker = _Marker as unknown as React.ComponentType<LeafletComponentProps>

// A count badge as a divIcon — also sidesteps Leaflet's broken default marker
// image paths under bundlers, and gives us the clustered look without a plugin.
function clusterIcon(count: number, color: string, contrast: string) {
  return L.divIcon({
    className: 'gig-cluster-icon',
    html:
      `<div style="background:${color};color:${contrast};width:28px;height:28px;` +
      'border-radius:50%;display:flex;align-items:center;justify-content:center;' +
      `font:600 13px sans-serif;box-shadow:0 0 0 2px #fff;">${count}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

interface FitBoundsProps {
  markers: MapMarker[]
}

function FitBounds({ markers }: FitBoundsProps) {
  const map = useMap()
  useEffect(() => {
    if (!markers.length) return
    const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lon] as [number, number]))
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 8 })
  }, [map, markers])
  return null
}

interface GigWorldMapProps {
  markers: MapMarker[]
  interactive?: boolean
  height?: number | string
}

/**
 * Shared Leaflet world map of past gigs. One pin per city showing the gig count;
 * in interactive mode each pin's popup lists that city's gigs (date + link).
 * In compact mode (interactive=false) interactions and popups are off so the
 * surrounding tile can own the click.
 */
export default function GigWorldMap({ markers, interactive = true, height = 320 }: GigWorldMapProps) {
  const theme = useTheme()
  const color = theme.palette.primary.main
  const contrast = theme.palette.primary.contrastText

  return (
    <Box
      sx={{
        height,
        width: '100%',
        borderRadius: 1,
        overflow: 'hidden',
        '& .leaflet-container': { height: '100%', width: '100%', bgcolor: 'action.hover' },
      }}
    >
      <MapContainer
        center={[25, 5] as [number, number]}
        zoom={1}
        worldCopyJump
        scrollWheelZoom={interactive}
        dragging={interactive}
        doubleClickZoom={interactive}
        zoomControl={interactive}
        keyboard={interactive}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer url={OSM_URL} attribution={OSM_ATTRIBUTION} />
        <FitBounds markers={markers} />
        {markers.map((m) => (
          <Marker key={m.key} position={[m.lat, m.lon] as [number, number]} icon={clusterIcon(m.gigs.length, color, contrast)}>
            {interactive && (
              <Popup>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  {m.label}
                </Typography>
                <Stack spacing={0.25}>
                  {m.gigs.map((g) => (
                    <Link
                      key={String(g.id)}
                      component={RouterLink}
                      to={`/gigs/${g.id}`}
                      underline="hover"
                      variant="body2"
                    >
                      {[formatShortDate(g.event_date), g.event_description].filter(Boolean).join(' · ')}
                    </Link>
                  ))}
                </Stack>
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>
    </Box>
  )
}
