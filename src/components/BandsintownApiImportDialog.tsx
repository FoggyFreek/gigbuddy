import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import AddLocationAltOutlinedIcon from '@mui/icons-material/AddLocationAltOutlined'
import VenuePicker from './VenuePicker.tsx'
import { getBandsintownEvents, importBandsintownEvents } from '../api/bandsintown.ts'
import type {
  BandsintownEvent,
  BandsintownImportResult,
  BandsintownImportRow,
} from '../api/bandsintown.ts'
import { useThemeMode } from '../contexts/themeModeContext.ts'
import type { Venue } from '../types/entities.ts'

interface BandsintownApiImportDialogProps {
  onClose: (created: boolean) => void
}

interface RowState {
  included: boolean
  venueType: 'venue' | 'festival'
  selectedVenue: Venue | null
  status: string
}

function buildInitialRowStates(events: BandsintownEvent[]): RowState[] {
  return events.map((event) => ({
    included: !event.is_duplicate,
    venueType: (event.matched_venue?.category === 'festival' || event.is_festival) ? 'festival' : 'venue',
    selectedVenue: event.matched_venue
      ? {
          id: event.matched_venue.id,
          name: event.matched_venue.name,
          category: event.matched_venue.category,
          city: event.matched_venue.city ?? undefined,
        }
      : null,
    status: 'confirmed',
  }))
}

function buildImportRow(event: BandsintownEvent, state: RowState): BandsintownImportRow {
  return {
    bandsintown_event_id: event.bandsintown_event_id,
    event_date: event.event_date,
    event_description: event.event_description,
    start_time: event.start_time,
    end_time: event.end_time,
    // The Bandsintown event page URL is deliberately not imported; duplicate
    // detection on re-import falls back to date + venue.
    event_link: null,
    ticket_link: event.ticket_link,
    admission: event.admission,
    venue: event.venue,
    venue_id: state.selectedVenue?.id ?? null,
    category: state.venueType,
    status: state.status,
  }
}

export default function BandsintownApiImportDialog({ onClose }: Readonly<BandsintownApiImportDialogProps>) {
  const { t } = useTranslation(['gigs', 'common'])
  const { mode } = useThemeMode()
  const [step, setStep] = useState('loading')
  const [artistName, setArtistName] = useState('')
  const [events, setEvents] = useState<BandsintownEvent[]>([])
  const [rowStates, setRowStates] = useState<RowState[]>([])
  const [result, setResult] = useState<BandsintownImportResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(() => {
    getBandsintownEvents()
      .then(({ artist, events: fetched }) => {
        setArtistName(artist.name)
        setEvents(fetched)
        setRowStates(buildInitialRowStates(fetched))
        setStep('review')
      })
      .catch((err) => {
        setLoadError((err as Error).message)
        setStep('error')
      })
  }, [])

  function updateRowState(index: number, patch: Partial<RowState>) {
    setRowStates((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      return next
    })
  }

  async function handleImport() {
    const payload = events.reduce<BandsintownImportRow[]>((acc, event, i) => {
      if (rowStates[i].included) acc.push(buildImportRow(event, rowStates[i]))
      return acc
    }, [])
    setStep('importing')
    try {
      setResult(await importBandsintownEvents(payload))
      setStep('done')
    } catch (err) {
      setImportError((err as Error).message || t($ => $.bandsintown.importFailed))
      setStep('review')
    }
  }

  const selectedCount = useMemo(
    () => rowStates.filter((s) => s.included).length,
    [rowStates],
  )

  return (
    <Dialog open fullWidth maxWidth="xl">
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            component="img"
            src={mode === 'dark' ? '/share/bit/01_BIT_Logo_OverDark.png' : '/share/bit/01_BIT_Logo_OverLite.png'}
            alt="Bandsintown"
            sx={{ height: 22 }}
          />
          {t($ => $.bandsintownApi.title)}
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {step === 'loading' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 4 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t($ => $.bandsintownApi.loading)}
            </Typography>
          </Box>
        )}

        {step === 'error' && (
          <Alert severity="error" sx={{ my: 2 }}>
            {loadError || t($ => $.bandsintownApi.fetchFailed)}
          </Alert>
        )}

        {step === 'review' && events.length === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
            {t($ => $.bandsintownApi.noEvents, { artist: artistName })}
          </Typography>
        )}

        {step === 'review' && events.length > 0 && (
          <Box>
            {importError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {importError}
              </Alert>
            )}
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
              {t($ => $.bandsintownApi.reviewIntro, { count: events.length, artist: artistName })}
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 900 }}>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>{t($ => $.bandsintown.colDate)}</TableCell>
                    <TableCell>{t($ => $.bandsintown.colEvent)}</TableCell>
                    <TableCell>{t($ => $.bandsintownApi.colVenue)}</TableCell>
                    <TableCell>{t($ => $.bandsintown.colType)}</TableCell>
                    <TableCell sx={{ minWidth: 280 }}>{t($ => $.bandsintown.colMatch)}</TableCell>
                    <TableCell>{t($ => $.bandsintown.colStatus)}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {events.map((event, i) => (
                    <TableRow
                      key={event.bandsintown_event_id ?? `${event.event_date}|${event.event_description}`}
                      sx={{ opacity: rowStates[i].included ? 1 : 0.45 }}
                    >
                      <TableCell padding="checkbox">
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Checkbox
                            size="small"
                            checked={rowStates[i].included}
                            onChange={(e) =>
                              updateRowState(i, { included: e.target.checked })
                            }
                          />
                          {event.is_duplicate && (
                            <Tooltip title={t($ => $.bandsintown.duplicateTooltip)}>
                              <WarningAmberIcon
                                fontSize="small"
                                color="warning"
                                sx={{ ml: -0.5 }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {event.event_date}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{event.event_description}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{event.venue.name}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {[event.venue.city, event.venue.country].filter(Boolean).join(', ')}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <ToggleButtonGroup
                          exclusive
                          size="small"
                          value={rowStates[i].venueType}
                          onChange={(_, val) => {
                            if (val) updateRowState(i, { venueType: val, selectedVenue: null })
                          }}
                        >
                          <ToggleButton value="venue">{t($ => $.bandsintown.typeVenue)}</ToggleButton>
                          <ToggleButton value="festival">{t($ => $.bandsintown.typeFestival)}</ToggleButton>
                        </ToggleButtonGroup>
                      </TableCell>
                      <TableCell sx={{ minWidth: 280 }}>
                        <VenuePicker
                          value={rowStates[i].selectedVenue}
                          categoryFilter={rowStates[i].venueType}
                          onChange={(v: Venue | null) => updateRowState(i, { selectedVenue: v })}
                          label={undefined}
                          disabled={false}
                          onSelect={undefined}
                        />
                        {!rowStates[i].selectedVenue && event.venue.name && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                            <AddLocationAltOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {t($ => $.bandsintownApi.willCreate, { name: event.venue.name })}
                            </Typography>
                          </Box>
                        )}
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          value={rowStates[i].status}
                          onChange={(e) => updateRowState(i, { status: e.target.value })}
                          sx={{ minWidth: 130 }}
                        >
                          <MenuItem value="option">{t($ => $.status.option)}</MenuItem>
                          <MenuItem value="confirmed">{t($ => $.status.confirmed)}</MenuItem>
                          <MenuItem value="announced">{t($ => $.status.announced)}</MenuItem>
                        </TextField>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Box>
        )}

        {step === 'importing' && (
          <Box sx={{ py: 4 }}>
            <LinearProgress sx={{ mb: 2 }} />
            <Typography variant="body2" align="center" sx={{ color: 'text.secondary' }}>
              {t($ => $.bandsintown.importing, { count: selectedCount })}
            </Typography>
          </Box>
        )}

        {step === 'done' && result && (
          <Box sx={{ py: 2 }}>
            <Alert severity="success">
              {result.skipped > 0
                ? t($ => $.bandsintown.doneWithSkip, { count: result.created, skipped: result.skipped })
                : t($ => $.bandsintown.doneNoSkip, { count: result.created })}
              {result.venues_created > 0 && (
                <> {t($ => $.bandsintownApi.venuesCreated, { count: result.venues_created })}</>
              )}
            </Alert>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        {(step === 'review' || step === 'error') && (
          <Button onClick={() => onClose(false)}>{t($ => $.common.actions.cancel)}</Button>
        )}
        {step === 'review' && events.length > 0 && (
          <Button
            variant="contained"
            disabled={selectedCount === 0}
            onClick={handleImport}
          >
            {t($ => $.bandsintown.importButton, { count: selectedCount })}
          </Button>
        )}
        {step === 'done' && (
          <Button
            variant="contained"
            onClick={() => onClose((result?.created ?? 0) > 0)}
          >
            {t($ => $.common.actions.close)}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
