import { useEffect, useMemo, useRef, useState } from 'react'
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
import { importGigs, listGigs } from '../api/gigs.ts'
import { searchVenues } from '../api/venues.ts'
import VenuePicker from './VenuePicker.tsx'
import {
  parseBandsintownCsv,
  venueMatchScore,
  isLikelyDuplicate,
} from '../utils/bandsintownImport.ts'
import type { ParsedBandsintownRow } from '../utils/bandsintownImport.ts'
import type { Venue, Gig } from '../types/entities.ts'

type BandsintownRow = ParsedBandsintownRow

interface BandsintownImportDialogProps {
  onClose: (created: boolean) => void
}

interface RowState {
  included: boolean
  venueType: string
  selectedVenue: Venue | null
  status: string
  isDuplicate: boolean
}

function buildInitialRowStates(rows: BandsintownRow[], existingGigs: Gig[]): RowState[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gigs = existingGigs as any[]
  return rows.map((row) => ({
    included: !isLikelyDuplicate(row, gigs),
    venueType: 'venue',
    selectedVenue: null,
    status: 'confirmed',
    isDuplicate: isLikelyDuplicate(row, gigs),
  }))
}

async function preFillVenueMatches(rows: BandsintownRow[], setRowStates: React.Dispatch<React.SetStateAction<RowState[]>>) {
  const seen = new Set<string>()
  const uniqueNames: string[] = []
  for (const row of rows) {
    const name = row.venueName.trim()
    if (name.length >= 3 && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase())
      uniqueNames.push(name)
    }
  }
  if (!uniqueNames.length) return

  const cache = new Map<string, Venue[]>()
  for (let i = 0; i < uniqueNames.length; i += 10) {
    const chunk = uniqueNames.slice(i, i + 10)
    const results = await Promise.allSettled(
      chunk.map((name) => searchVenues(name.slice(0, 25))),
    )
    results.forEach((res, j) => {
      cache.set(
        chunk[j].toLowerCase(),
        res.status === 'fulfilled' ? res.value : [],
      )
    })
  }

  setRowStates((prev) => {
    const next = [...prev]
    rows.forEach((row, i) => {
      const candidates = cache.get(row.venueName.toLowerCase()) || []
      if (!candidates.length) return
      const scored = candidates
        .map((v) => ({ venue: v, score: venueMatchScore(row.venueName, v.name ?? '') }))
        .sort((a, b) => b.score - a.score)
      if (scored[0].score >= 0.4) {
        next[i] = {
          ...next[i],
          selectedVenue: scored[0].venue,
          venueType: scored[0].venue.category ?? 'venue',
        }
      }
    })
    return next
  })
}

// Extra Bandsintown-specific fields the server accepts beyond the base Gig type.
interface BandsintownGigPayload extends Partial<Gig> {
  event_link?: string | null
  ticket_link?: string | null
  admission?: string
}

function buildGigPayload(row: BandsintownRow, state: RowState): BandsintownGigPayload {
  return {
    event_date: row.event_date,
    event_description: row.event_description,
    start_time: row.start_time || null,
    end_time: row.end_time || null,
    event_link: row.event_link || null,
    ticket_link: row.ticket_link || null,
    admission: row.admission,
    status: state.status,
    venue_id: state.venueType === 'venue' ? (state.selectedVenue?.id ?? null) : null,
    festival_id: state.venueType === 'festival' ? (state.selectedVenue?.id ?? null) : null,
  }
}

export default function BandsintownImportDialog({ onClose }: Readonly<BandsintownImportDialogProps>) {
  const { t } = useTranslation(['gigs', 'common'])
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [step, setStep] = useState('upload')
  const [rows, setRows] = useState<BandsintownRow[]>([])
  const [rowStates, setRowStates] = useState<RowState[]>([])
  const [existingGigs, setExistingGigs] = useState<Gig[]>([])
  const [gigsLoaded, setGigsLoaded] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(() => {
    listGigs()
      .then((gigs) => { setExistingGigs(gigs); setGigsLoaded(true) })
      .catch(() => setGigsLoaded(true))
  }, [])

  function updateRowState(index: number, patch: Partial<RowState>) {
    setRowStates((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], ...patch }
      return next
    })
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const text = await file.text()
    const { rows: parsed, parseError: err } = parseBandsintownCsv(text)
    if (err) {
      setParseError(err)
      return
    }
    setParseError(null)
    const initialStates = buildInitialRowStates(parsed as BandsintownRow[], existingGigs)
    setRows(parsed as BandsintownRow[])
    setRowStates(initialStates)
    setStep('review')
    preFillVenueMatches(parsed as BandsintownRow[], setRowStates)
  }

  async function handleImport() {
    const payload = rows.reduce<ReturnType<typeof buildGigPayload>[]>((acc, row, i) => {
      if (rowStates[i].included) acc.push(buildGigPayload(row, rowStates[i]))
      return acc
    }, [])
    setStep('importing')
    try {
      const res = await importGigs(payload)
      setResult(res as unknown as { created: number; skipped: number })
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
      <DialogTitle>{t($ => $.bandsintown.title)}</DialogTitle>

      <DialogContent dividers>
        {step === 'upload' && (
          <Box sx={{ py: 2 }}>
            {!gigsLoaded && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  {t($ => $.bandsintown.loadingGigList)}
                </Typography>
              </Box>
            )}
            {parseError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {parseError}
              </Alert>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t($ => $.bandsintown.uploadHint)}
            </Typography>
            <input
              type="file"
              accept=".csv"
              ref={fileRef}
              style={{ display: 'none' }}
              onChange={handleFile}
            />
            <Button
              disabled={!gigsLoaded}
              onClick={() => fileRef.current?.click()}
            >
              {t($ => $.bandsintown.chooseFile)}
            </Button>
          </Box>
        )}

        {step === 'review' && (
          <Box>
            {importError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {importError}
              </Alert>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t($ => $.bandsintown.reviewIntro, { count: rows.length })}
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 900 }}>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>{t($ => $.bandsintown.colDate)}</TableCell>
                    <TableCell>{t($ => $.bandsintown.colEvent)}</TableCell>
                    <TableCell>{t($ => $.bandsintown.colCsvVenueCity)}</TableCell>
                    <TableCell>{t($ => $.bandsintown.colType)}</TableCell>
                    <TableCell sx={{ minWidth: 280 }}>{t($ => $.bandsintown.colMatch)}</TableCell>
                    <TableCell>{t($ => $.bandsintown.colStatus)}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow
                      key={`${row.event_date}|${row.event_description}|${row.venueName}`}
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
                          {rowStates[i].isDuplicate && (
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
                        {row.event_date}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{row.event_description}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{row.venueName}</Typography>
                        {row.city && (
                          <Typography variant="caption" color="text.secondary">
                            {row.city}
                          </Typography>
                        )}
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
                          categoryFilter={rowStates[i].venueType as 'venue' | 'festival'}
                          onChange={(v: Venue | null) => updateRowState(i, { selectedVenue: v })}
                          label={undefined}
                          disabled={false}
                          onSelect={undefined}
                        />
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
            <Typography variant="body2" color="text.secondary" align="center">
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
            </Alert>
          </Box>
        )}
      </DialogContent>

      <DialogActions>
        {(step === 'upload' || step === 'review') && (
          <Button onClick={() => onClose(false)}>{t($ => $.common.actions.cancel)}</Button>
        )}
        {step === 'review' && (
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
