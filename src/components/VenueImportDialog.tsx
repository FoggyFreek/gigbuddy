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
import { importVenues } from '../api/venues.ts'

type ImportStep = 'upload' | 'map' | 'preview' | 'importing' | 'done'

type VenueFieldLabelKey =
  | 'venueName' | 'category' | 'title' | 'givenName' | 'familyName' | 'organizationName'
  | 'streetAndNumber' | 'streetAdditional' | 'postalCode' | 'city' | 'region' | 'country'
  | 'website' | 'phone' | 'email'

interface VenueField {
  key: string
  labelKey: VenueFieldLabelKey
  required: boolean
  aliases: string[]
}

const VENUE_FIELDS: VenueField[] = [
  { key: 'name',              labelKey: 'venueName',        required: true,  aliases: ['name', 'venue', 'venue name'] },
  { key: 'category',          labelKey: 'category',         required: false, aliases: ['category', 'type', 'venue type'] },
  { key: 'title',             labelKey: 'title',            required: false, aliases: ['title', 'salutation'] },
  { key: 'given_name',        labelKey: 'givenName',        required: false, aliases: ['given_name', 'given name', 'givenname', 'first name', 'firstname', 'contact_person', 'contact person', 'contact', 'booking contact'] },
  { key: 'family_name',       labelKey: 'familyName',       required: false, aliases: ['family_name', 'family name', 'familyname', 'last name', 'lastname', 'surname'] },
  { key: 'organization_name', labelKey: 'organizationName', required: false, aliases: ['organization_name', 'organization name', 'organizationname', 'organisation', 'organisation name', 'organization', 'company', 'company name'] },
  { key: 'street_and_number', labelKey: 'streetAndNumber',  required: false, aliases: ['street_and_number', 'street and number', 'streetandnumber', 'address', 'street', 'address line 1'] },
  { key: 'street_additional', labelKey: 'streetAdditional', required: false, aliases: ['street_additional', 'street additional', 'streetadditional', 'address line 2', 'address2'] },
  { key: 'postal_code',       labelKey: 'postalCode',       required: false, aliases: ['postal_code', 'postal code', 'postalcode', 'postcode', 'zip', 'zip code', 'zipcode'] },
  { key: 'city',              labelKey: 'city',             required: false, aliases: ['city'] },
  { key: 'region',            labelKey: 'region',           required: false, aliases: ['region', 'province', 'state'] },
  { key: 'country',           labelKey: 'country',          required: false, aliases: ['country'] },
  { key: 'website',           labelKey: 'website',          required: false, aliases: ['website', 'url', 'web'] },
  { key: 'phone',             labelKey: 'phone',            required: false, aliases: ['phone', 'tel', 'telephone', 'phone number'] },
  { key: 'email',             labelKey: 'email',            required: false, aliases: ['email', 'e-mail', 'email address'] },
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
  const { t } = useTranslation(['venues', 'common'])
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
    if (!mapping.name) errs.name = t($ => $.import.nameColumnRequired)
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
      setImportError((err as Error).message || t($ => $.import.importError))
      setStep('preview')
    }
  }

  const previewRows = csvRows.slice(0, 5).map((r) => applyMapping(r, mapping))

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>{t($ => $.import.title)}</DialogTitle>

      <DialogContent>
        {step === 'upload' && (
          <Box sx={{ py: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              {t($ => $.import.uploadHelp)}
            </Typography>
            <Button component="label">
              {t($ => $.import.chooseFile)}
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
              {t($ => $.import.mapHelp, { count: csvRows.length })}
            </Typography>
            <Grid container spacing={2}>
              {VENUE_FIELDS.map((field) => {
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
                      <MenuItem value="">{t($ => $.import.notMapped)}</MenuItem>
                      {csvHeaders.map((h) => (
                        <MenuItem key={h} value={h}>{h}</MenuItem>
                      ))}
                    </Select>
                    {mapErrors[field.key] && (
                      <FormHelperText>{mapErrors[field.key]}</FormHelperText>
                    )}
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
              {t($ => $.import.showing, { shown: Math.min(5, csvRows.length), total: csvRows.length })}
              {' '}{t($ => $.import.willImport, { count: importableCount })}
            </Typography>
            {importError && (
              <Alert severity="error" sx={{ mb: 2 }}>{importError}</Alert>
            )}
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                  <TableCell>{t($ => $.import.columns.category)}</TableCell>
                  <TableCell>{t($ => $.import.columns.name)}</TableCell>
                  <TableCell>{t($ => $.import.columns.city)}</TableCell>
                  <TableCell>{t($ => $.import.columns.country)}</TableCell>
                  <TableCell>{t($ => $.import.columns.contact)}</TableCell>
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
            {result.skipped > 0
              ? t($ => $.import.resultSkipped, { count: result.imported, skipped: result.skipped })
              : t($ => $.import.result, { count: result.imported })}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onClose(!!result)}>
          {result ? t($ => $.common.actions.close) : t($ => $.common.actions.cancel)}
        </Button>
        {step === 'map' && (
          <Button variant="outlined" onClick={handlePreview}>
            {t($ => $.import.preview)}
          </Button>
        )}
        {step === 'preview' && !result && (
          <Button variant="contained" onClick={handleImport} disabled={importableCount === 0}>
            {t($ => $.import.importButton, { count: importableCount })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
