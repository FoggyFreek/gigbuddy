import { useEffect } from 'react'
import PropTypes from 'prop-types'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { formatShortDate } from '../../utils/dateFormat.js'

// OSM tile usage requires visible attribution — keep it in every mode.
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// A count badge as a divIcon — also sidesteps Leaflet's broken default marker
// image paths under bundlers, and gives us the clustered look without a plugin.
function clusterIcon(count, color, contrast) {
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

function FitBounds({ markers }) {
  const map = useMap()
  useEffect(() => {
    if (!markers.length) return
    const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lon]))
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 8 })
  }, [map, markers])
  return null
}

FitBounds.propTypes = { markers: PropTypes.array.isRequired }

/**
 * Shared Leaflet world map of past gigs. One pin per city showing the gig count;
 * in interactive mode each pin's popup lists that city's gigs (date + link).
 * In compact mode (interactive=false) interactions and popups are off so the
 * surrounding tile can own the click.
 */
export default function GigWorldMap({ markers, interactive = true, height = 320 }) {
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
        center={[25, 5]}
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
          <Marker key={m.key} position={[m.lat, m.lon]} icon={clusterIcon(m.gigs.length, color, contrast)}>
            {interactive && (
              <Popup>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  {m.label}
                </Typography>
                <Stack spacing={0.25}>
                  {m.gigs.map((g) => (
                    <Link
                      key={g.id}
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

GigWorldMap.propTypes = {
  markers: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      lat: PropTypes.number.isRequired,
      lon: PropTypes.number.isRequired,
      label: PropTypes.string,
      gigs: PropTypes.array.isRequired,
    }),
  ).isRequired,
  interactive: PropTypes.bool,
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
}
