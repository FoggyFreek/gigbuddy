import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Skeleton from '@mui/material/Skeleton'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import { useTranslation } from 'react-i18next'
import DateEntryField from '../DateEntryField.tsx'
import VenuePicker from '../VenuePicker.tsx'
import { geocodePlace } from '../../utils/geocode.ts'
import { dayjsToTimeString, timeStringToDayjs } from '../../utils/eventFormUtils.ts'
import type { Venue } from '../../types/entities.ts'
import type { GigDetailForm } from './types.ts'

const STATUSES = ['option', 'confirmed', 'announced'] as const
const GigLocationMap = lazy(() => import('../map/GigLocationMap.tsx'))
const MAP_STREET_ZOOM = 16
const MAP_CITY_ZOOM = 11

interface Props {
  active: boolean
  editable: boolean
  form: GigDetailForm
  requiredErrors: Record<string, string>
  selectedVenue: Venue | null
  selectedFestival: Venue | null
  hideVenueOpenAction: boolean
  onChange: (field: string, value: unknown) => void
  onVenueChange: (venue: Venue | null) => void
  onFestivalChange: (festival: Venue | null) => void
}

export default function GigEventDetails({
  active,
  editable,
  form,
  requiredErrors,
  selectedVenue,
  selectedFestival,
  hideVenueOpenAction,
  onChange,
  onVenueChange,
  onFestivalChange,
}: Readonly<Props>) {
  const { t } = useTranslation('gigs')
  const [mapResult, setMapResult] = useState<{
    placeKey: string
    coords: { lat: number; lon: number } | null
  } | null>(null)

  const mapSource = selectedVenue?.city ? selectedVenue : selectedFestival
  const mapPlace = useMemo(() => {
    if (!mapSource?.city) return null
    return {
      city: mapSource.city,
      region: mapSource.region || undefined,
      country: mapSource.country || undefined,
      postalCode: mapSource.postal_code || undefined,
      address: mapSource.street_and_number || undefined,
    }
  }, [mapSource])
  const mapZoom = mapPlace?.address ? MAP_STREET_ZOOM : MAP_CITY_ZOOM
  const mapLabel = mapSource?.name || ''
  const mapPlaceKey = mapPlace
    ? [mapPlace.address, mapPlace.postalCode, mapPlace.city, mapPlace.region, mapPlace.country].join('|')
    : ''
  const mapCoords = mapResult?.placeKey === mapPlaceKey ? mapResult.coords : null
  const mapsHref = useMemo(() => {
    if (!mapCoords) return ''
    const query = [mapPlace?.address, mapPlace?.postalCode, mapPlace?.city, mapPlace?.country]
      .filter(Boolean)
      .join(', ') || `${mapCoords.lat},${mapCoords.lon}`
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  }, [mapCoords, mapPlace])

  useEffect(() => {
    if (!mapPlace) return
    let cancelled = false
    geocodePlace(mapPlace).then((coords) => {
      if (!cancelled) setMapResult({ placeKey: mapPlaceKey, coords })
    })
    return () => { cancelled = true }
  }, [mapPlace, mapPlaceKey])

  return (
    <Grid container spacing={2}>
      <Grid size={12}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {t($ => $.detail.eventDetails)}
        </Typography>
      </Grid>
      <Grid size={{ xs: 12, sm: 3 }}>
        <DateEntryField
          label={t($ => $.detail.date)}
          fullWidth
          required
          readOnly={!editable}
          value={form.event_date}
          onChange={(event) => onChange('event_date', event.target.value)}
          error={!!requiredErrors.event_date}
          helperText={requiredErrors.event_date}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 3 }}>
        <TimePicker
          label={t($ => $.detail.startTime)}
          ampm={false}
          readOnly={!editable}
          value={timeStringToDayjs(form.start_time)}
          onChange={(value) => onChange('start_time', dayjsToTimeString(value))}
          slotProps={{ textField: { fullWidth: true } }}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 3 }}>
        <TimePicker
          label={t($ => $.detail.endTime)}
          ampm={false}
          readOnly={!editable}
          value={timeStringToDayjs(form.end_time)}
          onChange={(value) => onChange('end_time', dayjsToTimeString(value))}
          slotProps={{ textField: { fullWidth: true } }}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 3 }}>
        <TextField
          select
          label={t($ => $.detail.status)}
          fullWidth
          disabled={!editable}
          value={form.status}
          onChange={(event) => onChange('status', event.target.value)}
        >
          {STATUSES.map((status) => (
            <MenuItem key={status} value={status}>{t($ => $.status[status])}</MenuItem>
          ))}
        </TextField>
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label={t($ => $.detail.eventDescription)}
          fullWidth
          required
          value={form.event_description}
          onChange={(event) => onChange('event_description', event.target.value)}
          error={!!requiredErrors.event_description}
          helperText={requiredErrors.event_description}
          slotProps={{ htmlInput: { readOnly: !editable } }}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <VenuePicker
          categoryFilter="festival"
          disabled={!editable}
          hideOpenAction={hideVenueOpenAction}
          value={selectedFestival}
          onChange={onFestivalChange}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <VenuePicker
          categoryFilter="venue"
          disabled={!editable}
          hideOpenAction={hideVenueOpenAction}
          value={selectedVenue}
          onChange={onVenueChange}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          label={t($ => $.detail.eventLink)}
          type="url"
          fullWidth
          value={form.event_link}
          onChange={(event) => onChange('event_link', event.target.value)}
          slotProps={{
            htmlInput: { readOnly: !editable },
            input: {
              endAdornment: form.event_link ? (
                <InputAdornment position="end">
                  <Tooltip title={t($ => $.detail.openLink)}>
                    <IconButton
                      size="small"
                      edge="end"
                      component="a"
                      href={form.event_link}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ) : null,
            },
          }}
        />
      </Grid>
      {active && mapCoords && (
        <Grid size={12}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t($ => $.detail.location)}
          </Typography>
          <Suspense fallback={<Skeleton variant="rounded" height={150} />}>
            <GigLocationMap
              key={`${mapCoords.lat},${mapCoords.lon},${mapZoom}`}
              lat={mapCoords.lat}
              lon={mapCoords.lon}
              zoom={mapZoom}
              label={mapLabel}
              openLabel={t($ => $.detail.openInMaps)}
              mapsHref={mapsHref}
            />
          </Suspense>
        </Grid>
      )}
    </Grid>
  )
}
