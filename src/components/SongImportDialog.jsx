import { useRef, useState } from 'react'
import PropTypes from 'prop-types'
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
import { importSongs } from '../api/songs.js'

const SONG_FIELDS = [
  { key: 'title',    label: 'Title',    required: true,  aliases: ['title', 'song', 'song title', 'name'] },
  { key: 'artist',   label: 'Artist',   required: false, aliases: ['artist', 'band', 'performer'] },
  { key: 'song_key', label: 'Key',      required: false, aliases: ['key', 'song key', 'song_key'] },
  { key: 'tempo',    label: 'Tempo',    required: false, aliases: ['tempo', 'bpm'] },
  { key: 'duration', label: 'Duration', required: false, aliases: ['duration', 'length', 'time', 'duration_seconds'] },
  { key: 'tags',     label: 'Tags',     required: false, aliases: ['tags', 'genre', 'genres', 'style'] },
]

function autoMap(headers) {
  const mapping = {}
  for (const field of SONG_FIELDS) {
    const match = headers.find((h) => field.aliases.includes(h.toLowerCase().trim()))
    mapping[field.key] = match || ''
  }
  return mapping
}

// Parse a duration cell that may be "mm:ss", "h:mm:ss" or plain seconds.
function durationToSeconds(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  const parts = s.split(':').map((p) => p.trim())
  if (parts.some((p) => !/^\d+$/.test(p))) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}

function applyMapping(row, mapping) {
  const get = (key) => {
    const col = mapping[key]
    return col ? (row[col] ?? '').toString().trim() : ''
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

export default function SongImportDialog({ onClose }) {
  const [step, setStep] = useState('upload') // 'upload' | 'map' | 'preview' | 'importing' | 'done'
  const [csvHeaders, setCsvHeaders] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [mapErrors, setMapErrors] = useState({})
  const [result, setResult] = useState(null)
  const [importError, setImportError] = useState(null)
  const fileRef = useRef(null)

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const parsed = Papa.parse(evt.target.result, { header: true, skipEmptyLines: true })
      const headers = parsed.meta.fields || []
      setCsvHeaders(headers)
      setCsvRows(parsed.data)
      setMapping(autoMap(headers))
      setStep('map')
    }
    reader.readAsText(file, 'UTF-8')
  }

  function handleMappingChange(fieldKey, col) {
    setMapping((prev) => ({ ...prev, [fieldKey]: col }))
    setMapErrors((prev) => ({ ...prev, [fieldKey]: undefined }))
  }

  function handlePreview() {
    if (!mapping.title) { setMapErrors({ title: 'Title column is required' }); return }
    setStep('preview')
  }

  const importableCount = csvRows.filter((r) => {
    const col = mapping.title
    return col && (r[col] ?? '').toString().trim()
  }).length

  async function handleImport() {
    if (importableCount === 0) return
    setStep('importing')
    setImportError(null)
    try {
      const rows = csvRows.map((r) => applyMapping(r, mapping)).filter((r) => r.title)
      const res = await importSongs(rows)
      setResult(res)
      setStep('done')
    } catch (err) {
      setImportError(err.message || 'Import failed')
      setStep('preview')
    }
  }

  const previewRows = csvRows.slice(0, 5).map((r) => applyMapping(r, mapping))

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>Import songs from CSV</DialogTitle>

      <DialogContent>
        {step === 'upload' && (
          <Box sx={{ py: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Upload a UTF-8 CSV file with column headers. Supported fields: title, artist, key,
              tempo, duration (mm:ss or seconds), tags (comma-separated).
            </Typography>
            <Button component="label">
              Choose CSV file
              {' '}
              <input ref={fileRef} type="file" accept=".csv" hidden onChange={handleFile} />
            </Button>
          </Box>
        )}

        {step === 'map' && (
          <Box sx={{ py: 1 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Map your CSV columns to song fields. {csvRows.length} rows detected.
            </Typography>
            <Grid container spacing={2}>
              {SONG_FIELDS.map((field) => (
                <Grid size={{ xs: 12, sm: 6 }} key={field.key}>
                  <FormControl fullWidth size="small" error={!!mapErrors[field.key]}>
                    <InputLabel>{field.label}{field.required ? ' *' : ''}</InputLabel>
                    <Select
                      label={field.label + (field.required ? ' *' : '')}
                      value={mapping[field.key] || ''}
                      onChange={(e) => handleMappingChange(field.key, e.target.value)}
                    >
                      <MenuItem value="">(not mapped)</MenuItem>
                      {csvHeaders.map((h) => (
                        <MenuItem key={h} value={h}>{h}</MenuItem>
                      ))}
                    </Select>
                    {mapErrors[field.key] && <FormHelperText>{mapErrors[field.key]}</FormHelperText>}
                  </FormControl>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        {step === 'preview' && (
          <Box sx={{ py: 1 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Showing first {Math.min(5, csvRows.length)} of {csvRows.length} rows.
              {' '}{importableCount} row{importableCount === 1 ? '' : 's'} will be imported.
            </Typography>
            {importError && <Alert severity="error" sx={{ mb: 2 }}>{importError}</Alert>}
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                  <TableCell>Title</TableCell>
                  <TableCell>Artist</TableCell>
                  <TableCell>Key</TableCell>
                  <TableCell>Tempo</TableCell>
                  <TableCell>Tags</TableCell>
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
            Imported {result.imported} song{result.imported === 1 ? '' : 's'}
            {result.skipped > 0 ? ` (${result.skipped} skipped as duplicates)` : ''}.
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onClose(!!result)}>{result ? 'Close' : 'Cancel'}</Button>
        {step === 'map' && <Button variant="outlined" onClick={handlePreview}>Preview</Button>}
        {step === 'preview' && !result && (
          <Button variant="contained" onClick={handleImport} disabled={importableCount === 0}>
            Import {importableCount} row{importableCount === 1 ? '' : 's'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

SongImportDialog.propTypes = {
  onClose: PropTypes.func.isRequired,
}
