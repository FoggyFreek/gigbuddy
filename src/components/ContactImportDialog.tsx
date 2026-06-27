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
import { importContacts } from '../api/contacts.ts'
import { useContactCategoryLabel } from '../utils/contactCategories.ts'

interface ContactImportDialogProps {
  onClose: (created: boolean) => void
  /** When set, every imported row is forced to this category and the category
   *  mapping/preview column is hidden (e.g. the suppliers directory). */
  fixedCategory?: string
  title?: string
}

const VALID_CATEGORIES = new Set(['press', 'radio & tv', 'booker', 'promotion', 'network'])

interface ContactField { key: string; labelKey: 'name' | 'email' | 'phone' | 'category'; required: boolean; aliases: string[] }

const CONTACT_FIELDS: ContactField[] = [
  { key: 'name',     labelKey: 'name',     required: true,  aliases: ['name', 'contact name', 'full name'] },
  { key: 'email',    labelKey: 'email',    required: false, aliases: ['email', 'e-mail', 'email address'] },
  { key: 'phone',    labelKey: 'phone',    required: false, aliases: ['phone', 'tel', 'phone number', 'telephone'] },
  { key: 'category', labelKey: 'category', required: false, aliases: ['category', 'type', 'contact type'] },
]

function coerceCategory(raw: string): string {
  if (!raw) return 'press'
  const lower = raw.toLowerCase().trim()
  if (VALID_CATEGORIES.has(lower)) return lower
  // fuzzy matches
  if (lower.includes('radio') || lower.includes('tv') || lower.includes('television')) return 'radio & tv'
  if (lower.includes('book')) return 'booker'
  if (lower.includes('promo')) return 'promotion'
  if (lower.includes('network')) return 'network'
  if (lower.includes('press')) return 'press'
  return 'press'
}

function autoMap(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const field of CONTACT_FIELDS) {
    const match = headers.find((h) => field.aliases.includes(h.toLowerCase()))
    mapping[field.key] = match || ''
  }
  return mapping
}

function applyMapping(
  row: Record<string, string>,
  mapping: Record<string, string>,
  fixedCategory?: string,
): Record<string, string> {
  const obj: Record<string, string> = {}
  for (const { key } of CONTACT_FIELDS) {
    const col = mapping[key]
    obj[key] = col ? (row[col] ?? '').toString().trim() : ''
  }
  obj.category = fixedCategory ?? coerceCategory(obj.category)
  return obj
}

export default function ContactImportDialog({ onClose, fixedCategory, title }: ContactImportDialogProps) {
  const { t } = useTranslation(['contacts', 'common'])
  const categoryLabel = useContactCategoryLabel()
  // In fixed-category mode the category column is neither mapped nor previewed.
  const fields = fixedCategory ? CONTACT_FIELDS.filter((f) => f.key !== 'category') : CONTACT_FIELDS
  const [step, setStep] = useState('upload') // 'upload' | 'map' | 'preview' | 'importing'
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<Array<Record<string, string>>>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [mapErrors, setMapErrors] = useState<Record<string, string | undefined>>({})
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt: ProgressEvent<FileReader>) => {
      const text = evt.target!.result as string
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true })
      const headers = (parsed.meta.fields || []) as string[]
      setCsvHeaders(headers)
      setCsvRows(parsed.data as Array<Record<string, string>>)
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

  async function handleImport() {
    if (importableCount === 0) return
    setStep('importing')
    setImportError(null)
    try {
      const rows = csvRows
        .map((r) => applyMapping(r, mapping, fixedCategory))
        .filter((r) => r.name)
      const res = await importContacts(rows) as unknown as { imported: number; skipped: number }
      setResult(res)
      setStep('done')
    } catch (err) {
      setImportError((err as Error).message || t($ => $.import.importError))
      setStep('preview')
    }
  }

  const previewRows = csvRows.slice(0, 5).map((r) => applyMapping(r, mapping, fixedCategory))
  const importableCount = csvRows.filter((r) => {
    const col = mapping.name
    return col && (r[col] ?? '').toString().trim()
  }).length

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>{title ?? t($ => $.import.title)}</DialogTitle>

      <DialogContent>
        {step === 'upload' && (
          <Box sx={{ py: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              {fixedCategory
                ? t($ => $.import.uploadHelpFixed, { category: categoryLabel(fixedCategory) })
                : t($ => $.import.uploadHelp)}
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
              {fields.map((field) => {
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
                  {!fixedCategory && <TableCell>{t($ => $.fields.category)}</TableCell>}
                  <TableCell>{t($ => $.fields.name)}</TableCell>
                  <TableCell>{t($ => $.fields.email)}</TableCell>
                  <TableCell>{t($ => $.fields.phone)}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {previewRows.map((row, i) => (
                  <TableRow key={`${i}-${row.name}`}>
                    {!fixedCategory && <TableCell>{row.category || '—'}</TableCell>}
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
