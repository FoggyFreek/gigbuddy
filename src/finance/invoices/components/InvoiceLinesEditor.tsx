import { useTranslation } from 'react-i18next'
import type { InvoiceForm, InvoiceFormLine } from './invoiceFormHelpers.ts'
import { computeInvoiceTotals, formatCurrency } from '../invoiceTotals.ts'
import { useAccountingProfile } from '../../../contexts/accountingProfileContext.ts'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import Link from '@mui/material/Link'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import {
  DataGrid, GridCellModes, renderEditSingleSelectCell, useGridApiRef,
  type GridColDef, type GridRenderCellParams, type GridRenderEditCellParams,
  type GridValueOptionsParams,
} from '@mui/x-data-grid'
import { enUS, nlNL } from '@mui/x-data-grid/locales'
import { vatRateOptions } from '../../vat/vatRates.ts'
import { commonVatSelection } from '../../../../shared/taxCategories.js'

// jsdom gives every element a zero-size box, so the virtualizer would render no
// rows at all. Only the test environment pays for rendering every row.
const DISABLE_VIRTUALIZATION = import.meta.env.MODE === 'test'

// The EU VIES VAT-number validation service. We link users here rather than
// integrating: they confirm the check, we retain the attestation.
const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/'

interface LineRow extends InvoiceFormLine {
  id: string
  idx: number
}

interface InvoiceLinesEditorProps {
  form: InvoiceForm
  totals: ReturnType<typeof computeInvoiceTotals>
  appliesKor?: boolean
  readOnly?: boolean
  patchForm: (patch: Partial<InvoiceForm>) => void
  patchLine: (idx: number, patch: Partial<InvoiceFormLine>) => void
  addLine: () => void
  removeLine: (idx: number) => void
}

export default function InvoiceLinesEditor({ form, totals, appliesKor, readOnly, patchForm, patchLine, addLine, removeLine }: Readonly<InvoiceLinesEditorProps>) {
  const { t, i18n } = useTranslation('invoices')
  const { t: tCommon } = useTranslation('common')
  const { profile, accountingCountry } = useAccountingProfile()
  const currency = profile?.base_currency ?? 'EUR'
  const apiRef = useGridApiRef()
  // KOR and reverse charge both remove VAT from the invoice, so the VAT controls
  // and column are hidden in either case.
  const noVat = Boolean(appliesKor) || Boolean(form.reverse_charge)

  function rateLabel(rate: number): string {
    if (accountingCountry.toLowerCase() !== 'nl') return `${rate}%`
    if (rate === 21) return tCommon($ => $.vat.rates.standard)
    if (rate === 9) return tCommon($ => $.vat.rates.reduced)
    if (rate === 0) return tCommon($ => $.vat.rates.zero)
    return `${rate}%`
  }

  // Picking a rate is the whole edit — close the cell as soon as the value has
  // landed rather than leaving the dropdown open until the reviewer clicks away.
  const renderSelectEditCell = (params: GridRenderEditCellParams<LineRow>) => renderEditSingleSelectCell({
    ...params,
    onValueChange: () => {
      setTimeout(() => apiRef.current?.stopCellEditMode({ id: params.id, field: params.field }))
    },
  })

  const rows: LineRow[] = form.lines.map((line, idx) => ({ ...line, id: line._key, idx }))

  const columns: GridColDef<LineRow>[] = [
    {
      field: 'description',
      headerName: t($ => $.lines.description),
      flex: 2,
      minWidth: 160,
      editable: !readOnly,
    },
    {
      field: 'quantity',
      headerName: t($ => $.lines.quantity),
      type: 'number',
      width: 90,
      editable: !readOnly,
    },
    {
      field: 'unit_price_cents',
      headerName: t($ => $.lines.price),
      type: 'number',
      width: 130,
      editable: !readOnly,
      valueGetter: (value: number) => (value ?? 0) / 100,
      valueSetter: (value: number, row) => ({ ...row, unit_price_cents: Math.round(Number(value) * 100) || 0 }),
      valueFormatter: (value: number) => formatCurrency(Math.round((value ?? 0) * 100), currency),
    },
    {
      field: 'tax_percentage',
      headerName: t($ => $.lines.vatPercentage),
      type: 'singleSelect',
      width: 170,
      editable: !readOnly,
      renderEditCell: renderSelectEditCell,
      valueOptions: (params: GridValueOptionsParams<LineRow>) => (
        vatRateOptions(accountingCountry, params.row?.tax_percentage).map((rate) => ({ value: rate, label: rateLabel(rate) }))
      ),
      valueFormatter: (value: number) => rateLabel(value),
      valueSetter: (value: number, row) => {
        const rate = Number(value)
        const taxSelection = commonVatSelection(accountingCountry, rate)
        return {
          ...row,
          tax_percentage: rate,
          tax_category_code: taxSelection?.tax_category_code ?? row.tax_category_code,
          tax_jurisdiction_code: taxSelection?.tax_jurisdiction_code ?? row.tax_jurisdiction_code,
        }
      },
    },
    {
      field: 'total',
      headerName: t($ => $.labels.total),
      type: 'number',
      width: 120,
      editable: false,
      sortable: false,
      filterable: false,
      valueGetter: (_value: never, row: LineRow) => {
        const lineTotals = totals.perLine[row.idx] || { grossCents: 0, netCents: 0, taxCents: 0 }
        return form.tax_inclusive ? lineTotals.grossCents : lineTotals.netCents
      },
      valueFormatter: (value: number) => formatCurrency(value, currency),
    },
    {
      field: 'delete',
      headerName: '',
      width: 48,
      editable: false,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: (params: GridRenderCellParams<LineRow>) => (
        <IconButton
          size="small"
          onClick={() => removeLine(params.row.idx)}
          disabled={readOnly || form.lines.length <= 1}
          aria-label={t($ => $.lines.removeLine)}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      ),
    },
  ]

  function processRowUpdate(newRow: LineRow): LineRow {
    patchLine(newRow.idx, {
      description: newRow.description,
      quantity: Number(newRow.quantity) || 0,
      unit_price_cents: newRow.unit_price_cents,
      tax_percentage: newRow.tax_percentage,
      tax_category_code: newRow.tax_category_code,
      tax_jurisdiction_code: newRow.tax_jurisdiction_code,
    })
    return newRow
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>{t($ => $.lines.title)}</Typography>
        {!appliesKor && (
          <FormControlLabel
            control={(
              <Switch
                size="small"
                checked={!!form.reverse_charge}
                onChange={(e) => patchForm({ reverse_charge: e.target.checked })}
                disabled={readOnly}
              />
            )}
            label={t($ => $.lines.reverseCharge)}
          />
        )}
        {!noVat && (
          <ToggleButtonGroup
            value={form.tax_inclusive ? 'inclusive' : 'exclusive'}
            exclusive
            size="small"
            onChange={(_e, v) => v && patchForm({ tax_inclusive: v === 'inclusive' })}
            disabled={readOnly}
          >
            <ToggleButton value="inclusive">{t($ => $.lines.inclusiveVat)}</ToggleButton>
            <ToggleButton value="exclusive">{t($ => $.lines.exclusiveVat)}</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>
      {form.reverse_charge && !appliesKor && (
        <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
          {t($ => $.lines.reverseChargeHint)}
        </Typography>
      )}
      {form.reverse_charge && !appliesKor && (
        <Box sx={{ mb: 1.5, pl: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <FormControlLabel
              control={(
                <Checkbox
                  size="small"
                  checked={!!form.vies_checked}
                  onChange={(e) => patchForm({ vies_checked: e.target.checked })}
                  disabled={readOnly}
                />
              )}
              label={t($ => $.lines.viesChecked)}
            />
            <Link href={VIES_URL} target="_blank" rel="noopener" variant="body2">
              {t($ => $.lines.viesOpen)}
            </Link>
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
            {t($ => $.lines.viesHint)}
          </Typography>
          {form.vies_checked && (
            <TextField
              size="small"
              label={t($ => $.lines.viesConsultation)}
              value={form.vies_consultation_number}
              onChange={(e) => patchForm({ vies_consultation_number: e.target.value })}
              disabled={readOnly}
              slotProps={{ htmlInput: { maxLength: 64 } }}
              sx={{ maxWidth: 320 }}
            />
          )}
        </Box>
      )}

      <Box sx={{ mb: 1.5, width: '100%' }}>
        <DataGrid<LineRow>
          apiRef={apiRef}
          rows={rows}
          columns={columns}
          columnVisibilityModel={{ tax_percentage: !noVat }}
          autoHeight
          density="compact"
          hideFooter
          disableRowSelectionOnClick
          disableColumnMenu
          disableVirtualization={DISABLE_VIRTUALIZATION}
          localeText={(i18n.language.startsWith('nl') ? nlNL : enUS).components.MuiDataGrid.defaultProps.localeText}
          processRowUpdate={processRowUpdate}
          onProcessRowUpdateError={() => { /* form state is authoritative */ }}
          // The VAT rate is a single select — one click opens its dropdown
          // rather than requiring the usual double-click to enter edit mode.
          onCellClick={(params) => {
            if (params.field !== 'tax_percentage') return
            if (!params.isEditable || params.cellMode !== GridCellModes.View) return
            apiRef.current?.startCellEditMode({ id: params.id, field: params.field })
          }}
          sx={{ '& .MuiDataGrid-cell': { alignItems: 'center' } }}
        />
      </Box>

      <Button size="small" startIcon={<AddIcon />} disabled={readOnly} onClick={addLine}>
        {t($ => $.lines.addItem)}
      </Button>
    </>
  )
}
