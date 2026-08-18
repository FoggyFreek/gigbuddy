import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { alpha, useTheme } from '@mui/material/styles'
import MapIcon from '@mui/icons-material/Map'
import { useThemeMode } from '../../../contexts/themeModeContext.ts'
import { geocodePlace } from '../geocode.ts'
import type { VenueForm } from './VenueFields.tsx'

const StaticLocationMap = lazy(() => import('../../../components/map/StaticLocationMap.tsx'))

const MAP_STREET_ZOOM = 16
const MAP_CITY_ZOOM = 12
// The address is edited in the form below this banner, so the map follows only
// once typing settles — one lookup per address, not one per keystroke.
const GEOCODE_SETTLE_MS = 800

interface VenueLocationHeaderProps {
  form: VenueForm
  /** Stored coordinates, when the venue already has them — no lookup needed. */
  latitude?: number | null
  longitude?: number | null
}

function mapsHref(form: VenueForm, coords: { lat: number; lon: number } | null): string {
  const query = [form.name, form.street_and_number, form.postal_code, form.city, form.country]
    .filter(Boolean)
    .join(', ') || (coords ? `${coords.lat},${coords.lon}` : '')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/**
 * The detail page's header: a non-interactive map of the venue's location, faded
 * from the page background on the left to fully transparent on the right, with
 * the venue's name and address reading over the opaque half. The floating tab
 * pill overlaps its bottom edge.
 */
export default function VenueLocationHeader({ form, latitude, longitude }: Readonly<VenueLocationHeaderProps>) {
  const { t } = useTranslation('venues')
  const theme = useTheme()
  const { mode } = useThemeMode()
  const [geocoded, setGeocoded] = useState<{ placeKey: string; coords: { lat: number; lon: number } | null } | null>(null)

  const city = String(form.city ?? '').trim()
  const address = String(form.street_and_number ?? '').trim()
  const placeKey = [address, form.postal_code, city, form.region, form.country].map((v) => String(v ?? '').trim()).join('|')

  const hasStored = Number.isFinite(latitude) && Number.isFinite(longitude)
  const coords = hasStored
    ? { lat: latitude as number, lon: longitude as number }
    : (geocoded?.placeKey === placeKey ? geocoded.coords : null)
  const zoom = address ? MAP_STREET_ZOOM : MAP_CITY_ZOOM

  const place = useMemo(() => (city ? {
    city,
    region: String(form.region ?? '').trim() || undefined,
    country: String(form.country ?? '').trim() || undefined,
    postalCode: String(form.postal_code ?? '').trim() || undefined,
    address: address || undefined,
  } : null), [city, address, form.region, form.country, form.postal_code])

  useEffect(() => {
    if (hasStored || !place) return
    let cancelled = false
    const timer = setTimeout(() => {
      geocodePlace(place).then((result) => {
        if (!cancelled) setGeocoded({ placeKey, coords: result })
      })
    }, GEOCODE_SETTLE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [place, placeKey, hasStored])

  // Fade the page's own background into the map, so the text half reads as page
  // and the right half as map — in whichever theme is active.
  const pageBg = theme.palette.background.default
  // Opaque behind the text, clear by the middle so the pin at the map's centre
  // stays readable.
  const scrim = `linear-gradient(to right, ${pageBg} 0%, ${alpha(pageBg, 0.9)} 25%, ${alpha(pageBg, 0.45)} 42%, ${alpha(pageBg, 0)} 60%)`
  const streetLine = [form.street_and_number, form.street_additional].filter(Boolean).join(', ')

  return (
    <Box
      data-testid="venue-location-header"
      sx={{
        position: 'relative',
        height: { xs: 120, sm: 140 },
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: mode === 'dark' ? 'background.paper' : 'action.hover',
      }}
    >
      {coords && (
        <Suspense fallback={null}>
          <StaticLocationMap key={`${coords.lat},${coords.lon},${zoom}`} lat={coords.lat} lon={coords.lon} zoom={zoom} />
        </Suspense>
      )}

      <Box aria-hidden sx={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', background: scrim }} />

      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          // Bottom-left of the header, clear of the floating tab pill that
          // overlaps the bottom centre.
          justifyContent: 'flex-end',
          alignItems: 'flex-start',
          textAlign: 'left',
          gap: 0,
          px: { xs: 2, sm: 3 },
          pb: 4,
          width: { xs: '100%', sm: '55%' },
          pointerEvents: 'none',
        }}
      >
        {/* h2 for the heading level; the banner is too short for the theme's
            default h2 size, so the scale is pinned to the box. */}
        <Typography variant="h2" sx={{ fontWeight: 700, fontSize: { xs: '1.75rem', sm: '2.25rem' }, lineHeight: 1.15 }}>
          {form.name}
        </Typography>
        {streetLine && (
          <Typography variant="subtitle1" sx={{ color: 'text.secondary' }}>{streetLine}</Typography>
        )}
        {city && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>{city}</Typography>
        )}
      </Box>

      <Tooltip title={t($ => $.detail.openInGoogleMaps)}>
        <IconButton
          size="small"
          aria-label={t($ => $.detail.openInGoogleMaps)}
          component="a"
          href={mapsHref(form, coords)}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            position: 'absolute',
            // Clear of the OSM attribution strip, which Leaflet pins to the
            // bottom-right corner.
            bottom: 24,
            right: 8,
            zIndex: 3,
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
