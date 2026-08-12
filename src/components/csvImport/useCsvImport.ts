import { useState } from 'react'
import Papa from 'papaparse'

export type CsvImportStep = 'upload' | 'map' | 'preview' | 'importing' | 'done'

export interface CsvImportResult {
  imported: number
  skipped: number
}

export interface CsvImportField {
  key: string
  /** Already-translated label. Feature namespaces can't be reached from here, so
   *  the caller resolves it with its own typed `t`. */
  label: string
  required?: boolean
  /** Lower-case CSV header names that auto-map onto this field. */
  aliases: string[]
}

export interface UseCsvImportOptions<Row extends Record<string, unknown>> {
  fields: CsvImportField[]
  /** Field whose column must be mapped, and whose value makes a row importable. */
  requiredFieldKey: string
  requiredFieldError: string
  /** Post-processes the raw mapped cell values into the shape the API expects. */
  transformRow?: (values: Record<string, string>) => Row
  onImport: (rows: Row[]) => Promise<CsvImportResult>
  importErrorFallback: string
}

const PREVIEW_ROW_COUNT = 5

function autoMap(headers: string[], fields: CsvImportField[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const field of fields) {
    const match = headers.find((h) => field.aliases.includes(h.toLowerCase().trim()))
    mapping[field.key] = match || ''
  }
  return mapping
}

export function useCsvImport<Row extends Record<string, unknown>>({
  fields,
  requiredFieldKey,
  requiredFieldError,
  transformRow,
  onImport,
  importErrorFallback,
}: UseCsvImportOptions<Row>) {
  const [step, setStep] = useState<CsvImportStep>('upload')
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<Record<string, unknown>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [mapErrors, setMapErrors] = useState<Record<string, string | undefined>>({})
  const [result, setResult] = useState<CsvImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  function toValues(row: Record<string, unknown>): Record<string, string> {
    const values: Record<string, string> = {}
    for (const { key } of fields) {
      const col = mapping[key]
      values[key] = col ? String(row[col] ?? '').trim() : ''
    }
    return values
  }

  const transform = transformRow ?? ((values) => values as Row)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      const parsed = Papa.parse(String(evt.target?.result ?? ''), { header: true, skipEmptyLines: true })
      const headers = (parsed.meta.fields as string[]) || []
      setCsvHeaders(headers)
      setCsvRows(parsed.data as Record<string, unknown>[])
      setMapping(autoMap(headers, fields))
      setStep('map')
    }
    reader.readAsText(file, 'UTF-8')
  }

  function handleMappingChange(fieldKey: string, col: string) {
    setMapping((prev) => ({ ...prev, [fieldKey]: col }))
    setMapErrors((prev) => ({ ...prev, [fieldKey]: undefined }))
  }

  function handlePreview() {
    if (!mapping[requiredFieldKey]) {
      setMapErrors({ [requiredFieldKey]: requiredFieldError })
      return
    }
    setStep('preview')
  }

  const importableCount = csvRows.filter((r) => {
    const col = mapping[requiredFieldKey]
    return col && String(r[col] ?? '').trim()
  }).length

  // The preview deliberately shows the first rows as-is, including any that will
  // be skipped, so a mis-mapped column is visible before importing.
  const previewRows = csvRows.slice(0, PREVIEW_ROW_COUNT).map((r) => transform(toValues(r)))

  async function handleImport() {
    if (importableCount === 0) return
    setStep('importing')
    setImportError(null)
    try {
      const rows = csvRows
        .map(toValues)
        .filter((values) => values[requiredFieldKey])
        .map(transform)
      setResult(await onImport(rows))
      setStep('done')
    } catch (err) {
      setImportError((err as Error).message || importErrorFallback)
      setStep('preview')
    }
  }

  return {
    step,
    csvHeaders,
    csvRowCount: csvRows.length,
    mapping,
    mapErrors,
    result,
    importError,
    importableCount,
    previewRows,
    previewRowCount: PREVIEW_ROW_COUNT,
    handleFile,
    handleMappingChange,
    handlePreview,
    handleImport,
  }
}
