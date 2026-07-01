import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Papa from 'papaparse'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import FormHelperText from '@mui/material/FormHelperText'
import Grid from '@mui/material/Grid'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import type { Song } from '../types/entities.ts'
import { importSongs } from '../api/songs.ts'

type ImportStep = 'upload' | 'map' | 'preview' | 'importing' | 'done'

interface SongField {
  key: string
  labelKey: 'title' | 'artist' | 'key' | 'tempo' | 'duration' | 'tags'
  required: boolean
  aliases: string[]
}

const SONG_FIELDS: SongField[] = [
  { key: 'title',    labelKey: 'title',    required: true,  aliases: ['title', 'song', 'song title', 'name'] },
  { key: 'artist',   labelKey: 'artist',   required: false, aliases: ['artist', 'band', 'performer'] },
  { key: 'song_key', labelKey: 'key',      required: false, aliases: ['key', 'song key', 'song_key'] },
  { key: 'tempo',    labelKey: 'tempo',    required: false, aliases: ['tempo', 'bpm'] },
  { key: 'duration', labelKey: 'duration', required: false, aliases: ['duration', 'length', 'time', 'duration_seconds'] },
  { key: 'tags',     labelKey: 'tags',     required: false, aliases: ['tags', 'genre', 'genres', 'style'] },
]

function autoMap(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const field of SONG_FIELDS) {
    const match = headers.find((h) => field.aliases.includes(h.toLowerCase().trim()))
    mapping[field.key] = match || ''
  }
  return mapping
}

// Parse a duration cell that may be "mm:ss", "h:mm:ss" or plain seconds.
function durationToSeconds(raw: unknown): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  const parts = s.split(':').map((p) => p.trim())
  if (parts.some((p) => !/^\d+$/.test(p))) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}

function applyMapping(row: Record<string, unknown>, mapping: Record<string, string>) {
  const get = (key: string) => {
    const col = mapping[key]
    return col ? String(row[col] ?? '').trim() : ''
  }
  return {
    title: get('title'),
    artist: get('artist'),
    song_key: get('song_key'),
    tempo: get('tempo') ? Number(get('tempo')) : null,
    duration_seconds: durationToSeconds(get('duration')),
    tags: get('tags'),
  }
}

interface SongImportDialogProps {
  onClose: (imported: boolean) => void
}

export default function SongImportDialog({ onClose }: Readonly<SongImportDialogProps>) {
  const { t } = useTranslation(['songs', 'common'])
  const [step, setStep] = useState<ImportStep>('upload')
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, unknown>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [mapErrors, setMapErrors] = useState<Record<string, string | undefined>>({})
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const parsed = Papa.parse(String(evt.target?.result ?? ''), { header: true, skipEmptyLines: true })
      const headers = (parsed.meta.fields as string[]) || []
      setCsvHeaders(headers)
      setCsvRows(parsed.data as Record<string, unknown>[])
      setMapping(autoMap(headers))
      setStep('map')
    }
    reader.readAsText(file, 'UTF-8')
  }

  function handleMappingChange(fieldKey: string, col: string) {
    setMapping((prev) => ({ ...prev, [fieldKey]: col }))
    setMapErrors((prev) => ({ ...prev, [fieldKey]: undefined }))
  }

  function handlePreview() {
    if (!mapping.title) { setMapErrors({ title: t($ => $.import.titleColumnRequired) }); return }
    setStep('preview')
  }

  const importableCount = csvRows.filter((r) => {
    const col = mapping.title
    return col && String(r[col] ?? '').trim()
  }).length

  async function handleImport() {
    if (importableCount === 0) return
    setStep('importing')
    setImportError(null)
    try {
      const rows = csvRows.map((r) => applyMapping(r, mapping)).filter((r) => r.title) as unknown as Partial<Song>[]
      const res = await importSongs(rows)
      setResult(res as unknown as { imported: number; skipped: number })
      setStep('done')
    } catch (err) {
      setImportError((err as Error).message || t($ => $.csvImport.importError, { ns: 'common' }))
      setStep('preview')
    }
  }

  const previewRows = csvRows.slice(0, 5).map((r) => applyMapping(r, mapping))

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>{t($ => $.import.csvTitle)}</DialogTitle>

      <DialogContent>
        {step === 'upload' && (
          <Box sx={{ py: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              {t($ => $.import.uploadHelp)}
            </Typography>
            <Button component="label">
              {t($ => $.csvImport.chooseFile, { ns: 'common' })}
              {' '}
              <input ref={fileRef} type="file" accept=".csv" hidden onChange={handleFile} />
            </Button>
          </Box>
        )}

        {step === 'map' && (
          <Box sx={{ py: 1 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              {t($ => $.import.mapHelp, { count: csvRows.length })}
            </Typography>
            <Grid container spacing={2}>
              {SONG_FIELDS.map((field) => {
                const label = t($ => $.fields[field.labelKey]) + (field.required ? ' *' : '')
                return (
                <Grid size={{ xs: 12, sm: 6 }} key={field.key}>
                  <FormControl fullWidth size="small" error={!!mapErrors[field.key]}>
                    <InputLabel>{label}</InputLabel>
                    <Select
                      label={label}
                      value={mapping[field.key] || ''}
                      onChange={(e) => handleMappingChange(field.key, e.target.value)}
                    >
                      <MenuItem value="">{t($ => $.csvImport.notMapped, { ns: 'common' })}</MenuItem>
                      {csvHeaders.map((h) => (
                        <MenuItem key={h} value={h}>{h}</MenuItem>
                      ))}
                    </Select>
                    {mapErrors[field.key] && <FormHelperText>{mapErrors[field.key]}</FormHelperText>}
                  </FormControl>
                </Grid>
                )
              })}
            </Grid>
          </Box>
        )}

        {step === 'preview' && (
          <Box sx={{ py: 1 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {t($ => $.csvImport.showing, { ns: 'common', shown: Math.min(5, csvRows.length), total: csvRows.length })}
              {' '}{t($ => $.csvImport.willImport, { ns: 'common', count: importableCount })}
            </Typography>
            {importError && <Alert severity="error" sx={{ mb: 2 }}>{importError}</Alert>}
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                  <TableCell>{t($ => $.fields.title)}</TableCell>
                  <TableCell>{t($ => $.fields.artist)}</TableCell>
                  <TableCell>{t($ => $.fields.key)}</TableCell>
                  <TableCell>{t($ => $.fields.tempo)}</TableCell>
                  <TableCell>{t($ => $.fields.tags)}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {previewRows.map((row) => (
                  <TableRow key={`${row.title || ''}|${row.artist || ''}|${row.tempo ?? ''}`}>
                    <TableCell><strong>{row.title || '—'}</strong></TableCell>
                    <TableCell>{row.artist || '—'}</TableCell>
                    <TableCell>{row.song_key || '—'}</TableCell>
                    <TableCell>{row.tempo ?? '—'}</TableCell>
                    <TableCell>{row.tags || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {step === 'importing' && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {result && (
          <Alert severity="success" sx={{ mt: 2 }}>
            {result.skipped > 0
              ? t($ => $.import.resultSkipped, { count: result.imported, skipped: result.skipped })
              : t($ => $.import.result, { count: result.imported })}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onClose(!!result)}>{result ? t($ => $.common.actions.close) : t($ => $.common.actions.cancel)}</Button>
        {step === 'map' && <Button variant="outlined" onClick={handlePreview}>{t($ => $.preview)}</Button>}
        {step === 'preview' && !result && (
          <Button variant="contained" onClick={handleImport} disabled={importableCount === 0}>
            {t($ => $.csvImport.importButton, { ns: 'common', count: importableCount })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
