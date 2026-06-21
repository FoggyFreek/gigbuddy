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
import { importVenues } from '../api/venues.ts'

type ImportStep = 'upload' | 'map' | 'preview' | 'importing' | 'done'

interface VenueField {
  key: string
  label: string
  required: boolean
  aliases: string[]
}

const VENUE_FIELDS: VenueField[] = [
  { key: 'name',              label: 'Venue name',        required: true,  aliases: ['name', 'venue', 'venue name'] },
  { key: 'category',          label: 'Category',          required: false, aliases: ['category', 'type', 'venue type'] },
  { key: 'title',             label: 'Title',             required: false, aliases: ['title', 'salutation'] },
  { key: 'given_name',        label: 'Given name',        required: false, aliases: ['given_name', 'given name', 'givenname', 'first name', 'firstname', 'contact_person', 'contact person', 'contact', 'booking contact'] },
  { key: 'family_name',       label: 'Family name',       required: false, aliases: ['family_name', 'family name', 'familyname', 'last name', 'lastname', 'surname'] },
  { key: 'organization_name', label: 'Organization name', required: false, aliases: ['organization_name', 'organization name', 'organizationname', 'organisation', 'organisation name', 'organization', 'company', 'company name'] },
  { key: 'street_and_number', label: 'Street and number', required: false, aliases: ['street_and_number', 'street and number', 'streetandnumber', 'address', 'street', 'address line 1'] },
  { key: 'street_additional', label: 'Street additional', required: false, aliases: ['street_additional', 'street additional', 'streetadditional', 'address line 2', 'address2'] },
  { key: 'postal_code',       label: 'Postal code',       required: false, aliases: ['postal_code', 'postal code', 'postalcode', 'postcode', 'zip', 'zip code', 'zipcode'] },
  { key: 'city',              label: 'City',              required: false, aliases: ['city'] },
  { key: 'region',            label: 'Region',            required: false, aliases: ['region', 'province', 'state'] },
  { key: 'country',           label: 'Country',           required: false, aliases: ['country'] },
  { key: 'website',           label: 'Website',           required: false, aliases: ['website', 'url', 'web'] },
  { key: 'phone',             label: 'Phone',             required: false, aliases: ['phone', 'tel', 'telephone', 'phone number'] },
  { key: 'email',             label: 'Email',             required: false, aliases: ['email', 'e-mail', 'email address'] },
]

function autoMap(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const field of VENUE_FIELDS) {
    const match = headers.find((h) => field.aliases.includes(h.toLowerCase()))
    mapping[field.key] = match || ''
  }
  return mapping
}

function applyMapping(row: Record<string, unknown>, mapping: Record<string, string>): Record<string, string> {
  const obj: Record<string, string> = {}
  for (const { key } of VENUE_FIELDS) {
    const col = mapping[key]
    obj[key] = col ? String(row[col] ?? '').trim() : ''
  }
  const category = obj.category?.toLowerCase()
  obj.category = category === 'venue' || category === 'festival' ? category : 'venue'
  return obj
}

interface VenueImportDialogProps {
  onClose: (imported: boolean) => void
}

export default function VenueImportDialog({ onClose }: VenueImportDialogProps) {
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
      const text = String(evt.target?.result ?? '')
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
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
    const errs: Record<string, string> = {}
    if (!mapping.name) errs.name = 'Name column is required'
    if (Object.keys(errs).length) { setMapErrors(errs); return }
    setStep('preview')
  }

  const importableCount = csvRows.filter((r) => {
    const col = mapping.name
    return col && String(r[col] ?? '').trim()
  }).length

  async function handleImport() {
    if (importableCount === 0) return
    setStep('importing')
    setImportError(null)
    try {
      const rows = csvRows
        .map((r) => applyMapping(r, mapping))
        .filter((r) => r.name)
      const res = await importVenues(rows)
      setResult(res as unknown as { imported: number; skipped: number })
      setStep('done')
    } catch (err) {
      setImportError((err as Error).message || 'Import failed')
      setStep('preview')
    }
  }

  const previewRows = csvRows.slice(0, 5).map((r) => applyMapping(r, mapping))

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>Import Venues from CSV</DialogTitle>

      <DialogContent>
        {step === 'upload' && (
          <Box sx={{ py: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Upload a UTF-8 CSV file with column headers. Supported fields: name,
              category, title, given name, family name, organization name, street
              and number, street additional, postal code, city, region, country, website, phone,
              email.
            </Typography>
            <Button component="label">
              {'Choose CSV file'}
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
              Map your CSV columns to venue fields. {csvRows.length} rows detected.
            </Typography>
            <Grid container spacing={2}>
              {VENUE_FIELDS.map((field) => (
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
                  <TableCell>City</TableCell>
                  <TableCell>Country</TableCell>
                  <TableCell>Contact</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {previewRows.map((row, i) => {
                  const contact = [row.title, row.given_name, row.family_name].filter(Boolean).join(' ')
                  return (
                    <TableRow key={`${i}-${row.name}`}>
                      <TableCell>{row.category || '—'}</TableCell>
                      <TableCell><strong>{row.name || '—'}</strong></TableCell>
                      <TableCell>{row.city || '—'}</TableCell>
                      <TableCell>{row.country || '—'}</TableCell>
                      <TableCell>{contact || '—'}</TableCell>
                    </TableRow>
                  )
                })}
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
            Imported {result.imported} venue{result.imported !== 1 ? 's' : ''}
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
