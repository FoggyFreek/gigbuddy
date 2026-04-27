import { useRef, useState } from 'react'
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
import { importContacts } from '../api/contacts.js'

const VALID_CATEGORIES = ['press', 'radio & tv', 'booker', 'promotion', 'network']

const CONTACT_FIELDS = [
  { key: 'name',     label: 'Name',     required: true,  aliases: ['name', 'contact name', 'full name'] },
  { key: 'email',    label: 'Email',    required: false, aliases: ['email', 'e-mail', 'email address'] },
  { key: 'phone',    label: 'Phone',    required: false, aliases: ['phone', 'tel', 'phone number', 'telephone'] },
  { key: 'category', label: 'Category', required: false, aliases: ['category', 'type', 'contact type'] },
]

function coerceCategory(raw) {
  if (!raw) return 'press'
  const lower = raw.toLowerCase().trim()
  if (VALID_CATEGORIES.includes(lower)) return lower
  // fuzzy matches
  if (lower.includes('radio') || lower.includes('tv') || lower.includes('television')) return 'radio & tv'
  if (lower.includes('book')) return 'booker'
  if (lower.includes('promo')) return 'promotion'
  if (lower.includes('network')) return 'network'
  if (lower.includes('press')) return 'press'
  return 'press'
}

function autoMap(headers) {
  const mapping = {}
  for (const field of CONTACT_FIELDS) {
    const match = headers.find((h) => field.aliases.includes(h.toLowerCase()))
    mapping[field.key] = match || ''
  }
  return mapping
}

function applyMapping(row, mapping) {
  const obj = {}
  for (const { key } of CONTACT_FIELDS) {
    const col = mapping[key]
    obj[key] = col ? (row[col] ?? '').toString().trim() : ''
  }
  obj.category = coerceCategory(obj.category)
  return obj
}

export default function ContactImportDialog({ onClose }) {
  const [step, setStep] = useState('upload') // 'upload' | 'map' | 'preview' | 'importing'
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
      const text = evt.target.result
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
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
    const errs = {}
    if (!mapping.name) errs.name = 'Name column is required'
    if (Object.keys(errs).length) { setMapErrors(errs); return }
    setStep('preview')
  }

  async function handleImport() {
    if (importableCount === 0) return
    setStep('importing')
    setImportError(null)
    try {
      const rows = csvRows
        .map((r) => applyMapping(r, mapping))
        .filter((r) => r.name)
      const res = await importContacts(rows)
      setResult(res)
      setStep('done')
    } catch (err) {
      setImportError(err.message || 'Import failed')
      setStep('preview')
    }
  }

  const previewRows = csvRows.slice(0, 5).map((r) => applyMapping(r, mapping))
  const importableCount = csvRows.filter((r) => {
    const col = mapping.name
    return col && (r[col] ?? '').toString().trim()
  }).length

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>Import Contacts from CSV</DialogTitle>

      <DialogContent>
        {step === 'upload' && (
          <Box sx={{ py: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Upload a UTF-8 CSV file with column headers. Supported fields: name, email, phone, category.
              Category values: press, radio &amp; tv, booker, promotion, network (defaults to press if unrecognised).
            </Typography>
            <Button variant="outlined" component="label">
              Choose CSV file
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                hidden
                onChange={handleFile}
              />
            </Button>
          </Box>
        )}

        {step === 'map' && (
          <Box sx={{ py: 1 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Map your CSV columns to contact fields. {csvRows.length} rows detected.
            </Typography>
            <Grid container spacing={2}>
              {CONTACT_FIELDS.map((field) => (
                <Grid size={{ xs: 12, sm: 6 }} key={field.key}>
                  <FormControl fullWidth size="small" error={!!mapErrors[field.key]}>
                    <InputLabel>
                      {field.label}{field.required ? ' *' : ''}
                    </InputLabel>
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
                    {mapErrors[field.key] && (
                      <FormHelperText>{mapErrors[field.key]}</FormHelperText>
                    )}
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
              {importableCount} row{importableCount !== 1 ? 's' : ''} will be imported.
            </Typography>
            {importError && (
              <Alert severity="error" sx={{ mb: 2 }}>{importError}</Alert>
            )}
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                  <TableCell>Category</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Phone</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {previewRows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>{row.category || '—'}</TableCell>
                    <TableCell><strong>{row.name || '—'}</strong></TableCell>
                    <TableCell>{row.email || '—'}</TableCell>
                    <TableCell>{row.phone || '—'}</TableCell>
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
            Imported {result.imported} contact{result.imported !== 1 ? 's' : ''}
            {result.skipped > 0 ? ` (${result.skipped} skipped as duplicates)` : ''}.
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onClose(!!result)}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        {step === 'map' && (
          <Button variant="outlined" onClick={handlePreview}>
            Preview
          </Button>
        )}
        {step === 'preview' && !result && (
          <Button variant="contained" onClick={handleImport} disabled={importableCount === 0}>
            Import {importableCount} row{importableCount !== 1 ? 's' : ''}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
