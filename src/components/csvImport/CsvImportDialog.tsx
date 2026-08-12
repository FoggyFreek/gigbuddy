import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useCsvImport } from './useCsvImport.ts'
import type { CsvImportField, CsvImportResult } from './useCsvImport.ts'

export interface CsvPreviewColumn<Row extends Record<string, unknown>> {
  /** Key into the transformed row; also the default cell value. */
  key: string
  header: string
  strong?: boolean
  render?: (row: Row) => ReactNode
}

interface CsvImportDialogProps<Row extends Record<string, unknown>> {
  fields: CsvImportField[]
  previewColumns: CsvPreviewColumn<Row>[]
  requiredFieldKey: string
  /** Overrides the generic "Name column is required" message. */
  requiredFieldError?: string
  transformRow?: (values: Record<string, string>) => Row
  onImport: (rows: Row[]) => Promise<CsvImportResult>
  onClose: (imported: boolean) => void
  title: string
  uploadHelp: ReactNode
  mapHelp: (rowCount: number) => string
  formatResult: (result: CsvImportResult) => string
}

/**
 * The shared CSV import flow: upload → map columns → preview → import.
 *
 * Only `common:csvImport.*` strings live here; every feature-namespace string is
 * resolved by the caller and passed in, because the typed i18n selector cannot
 * reach a feature namespace from a shared component.
 */
export default function CsvImportDialog<Row extends Record<string, unknown>>({
  fields,
  previewColumns,
  requiredFieldKey,
  requiredFieldError,
  transformRow,
  onImport,
  onClose,
  title,
  uploadHelp,
  mapHelp,
  formatResult,
}: Readonly<CsvImportDialogProps<Row>>) {
  const { t } = useTranslation('common')
  const {
    step, csvHeaders, csvRowCount, mapping, mapErrors, result, importError,
    importableCount, previewRows, previewRowCount,
    handleFile, handleMappingChange, handlePreview, handleImport,
  } = useCsvImport<Row>({
    fields,
    requiredFieldKey,
    requiredFieldError: requiredFieldError ?? t($ => $.csvImport.nameColumnRequired),
    transformRow,
    onImport,
    importErrorFallback: t($ => $.csvImport.importError),
  })

  return (
    <Dialog open fullWidth maxWidth="md">
      <DialogTitle>{title}</DialogTitle>

      <DialogContent>
        {step === 'upload' && (
          <Box sx={{ py: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>{uploadHelp}</Typography>
            <Button component="label">
              {t($ => $.csvImport.chooseFile)}
              <input type="file" accept=".csv" hidden onChange={handleFile} />
            </Button>
          </Box>
        )}

        {step === 'map' && (
          <Box sx={{ py: 1 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>{mapHelp(csvRowCount)}</Typography>
            <Grid container spacing={2}>
              {fields.map((field) => {
                const label = field.label + (field.required ? ' *' : '')
                return (
                  <Grid size={{ xs: 12, sm: 6 }} key={field.key}>
                    <FormControl fullWidth size="small" error={!!mapErrors[field.key]}>
                      <InputLabel>{label}</InputLabel>
                      <Select
                        label={label}
                        value={mapping[field.key] || ''}
                        onChange={(e) => handleMappingChange(field.key, e.target.value)}
                      >
                        <MenuItem value="">{t($ => $.csvImport.notMapped)}</MenuItem>
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
              {t($ => $.csvImport.showing, { shown: Math.min(previewRowCount, csvRowCount), total: csvRowCount })}
              {' '}{t($ => $.csvImport.willImport, { count: importableCount })}
            </Typography>
            {importError && <Alert severity="error" sx={{ mb: 2 }}>{importError}</Alert>}
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                  {previewColumns.map((col) => (
                    <TableCell key={col.key}>{col.header}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {previewRows.map((row, i) => (
                  <TableRow key={`${i}-${String(row[requiredFieldKey] ?? '')}`}>
                    {previewColumns.map((col) => {
                      const cell = col.render
                        ? col.render(row)
                        : String(row[col.key] ?? '') || '—'
                      return (
                        <TableCell key={col.key}>
                          {col.strong ? <strong>{cell}</strong> : cell}
                        </TableCell>
                      )
                    })}
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

        {result && <Alert severity="success" sx={{ mt: 2 }}>{formatResult(result)}</Alert>}
      </DialogContent>

      <DialogActions>
        <Button onClick={() => onClose(!!result)}>
          {result ? t($ => $.actions.close) : t($ => $.actions.cancel)}
        </Button>
        {step === 'map' && (
          <Button variant="outlined" onClick={handlePreview}>{t($ => $.csvImport.preview)}</Button>
        )}
        {step === 'preview' && !result && (
          <Button variant="contained" onClick={handleImport} disabled={importableCount === 0}>
            {t($ => $.csvImport.importButton, { count: importableCount })}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
