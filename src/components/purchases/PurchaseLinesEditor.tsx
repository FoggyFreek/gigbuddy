import type { Account, Product } from '../../types/entities.ts'
import { useTranslation } from 'react-i18next'
import type { PurchaseForm, PurchaseFormLine } from './purchaseFormHelpers.ts'
import { computePurchaseTotals } from '../../utils/purchaseTotals.ts'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import IconButton from '@mui/material/IconButton'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import MoneyInput from '../invoices/MoneyInput.tsx'
import { centsToEditableEuro } from '../invoices/invoiceFormHelpers.ts'
import { TAX_RATES } from './purchaseFormHelpers.ts'

type AccountGroupKey = 'asset' | 'cost_of_goods_sold' | 'expense'

function isAccountGroupKey(value: string | undefined): value is AccountGroupKey {
  return value === 'asset' || value === 'cost_of_goods_sold' || value === 'expense'
}

// A stale account extension — same pattern as AccountAutocomplete.tsx.
type AccountOption = Account & { __stale?: boolean }

type LineTotals = ReturnType<typeof computePurchaseTotals>['perLine'][number]

/** Per-line validation errors keyed by field name. */
type LineErrors = Record<string, string>

interface PurchaseLineRowProps {
  line: PurchaseFormLine
  idx: number
  accounts?: Account[]
  products?: Product[]
  vatCents?: number
  errors?: LineErrors
  readOnly?: boolean
  canRemove?: boolean
  patchLine: (idx: number, patch: Partial<PurchaseFormLine>) => void
  removeLine: (idx: number) => void
}

function PurchaseLineRow({ line, idx, accounts = [], products = [], vatCents, errors = {}, readOnly, canRemove, patchLine, removeLine }: PurchaseLineRowProps) {
  const { t } = useTranslation('purchases')
  const accountGroup = (account: AccountOption) => {
    const type = isAccountGroupKey(account.type) ? account.type : 'expense'
    return t($ => $.lines.accountGroups[type])
  }
  // A saved line can reference an account that is no longer active/expense-typed.
  // Surface it as a disabled option so the field doesn't silently drop it.
  const knownAccount = accounts.find((a) => a.code === line.account_code) || null
  const selectedAccount: AccountOption | null = line.account_code
    ? (knownAccount || { code: line.account_code, name: t($ => $.lines.inactiveAccount), __stale: true })
    : null
  // groupBy needs options pre-sorted by group so each header appears once.
  const accountOptions: AccountOption[] = (selectedAccount?.__stale ? [selectedAccount, ...accounts] : accounts)
    .slice()
    .sort((a, b) => accountGroup(a).localeCompare(accountGroup(b)) || (a.code ?? '').localeCompare(b.code ?? ''))
  // A saved line can reference a product that has since been archived.
  const lineProduct = products.find((p) => p.id === line.product_id) || null
  const productOptions = products.filter((p) => !p.archived_at || p.id === line.product_id)
  const stocksProduct = Boolean(line.product_id)
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {t($ => $.lines.lineNumber, { number: idx + 1 })}
        </Typography>
        {canRemove && (
          <IconButton size="small" onClick={() => removeLine(idx)} disabled={readOnly} aria-label={t($ => $.lines.removeLine)}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Box sx={{ mb: 2 }}>
        <TextField
          label={t($ => $.labels.description)}
          size="small"
          fullWidth
          placeholder={t($ => $.lines.descriptionPlaceholder)}
          value={line.description}
          onChange={(e) => patchLine(idx, { description: e.target.value })}
          disabled={readOnly}
          error={Boolean(errors.description)}
          helperText={errors.description}
        />
      </Box>

      {(productOptions.length > 0 || stocksProduct) && (
        <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2, mb: 2 }}>
          <Autocomplete
            size="small"
            disabled={readOnly}
            options={productOptions}
            value={lineProduct}
            onChange={(_e, picked) => patchLine(idx, {
              product_id: picked?.id ?? null,
              quantity: picked ? (line.quantity || 1) : null,
            })}
            getOptionLabel={(o) => (o ? o.name ?? '' : '')}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t($ => $.lines.stockProduct)}
                placeholder={t($ => $.lines.noProduct)}
              />
            )}
          />
          <TextField
            label={t($ => $.lines.quantity)}
            size="small"
            type="number"
            disabled={readOnly || !stocksProduct}
            value={stocksProduct ? (line.quantity ?? '') : ''}
            onChange={(e) => patchLine(idx, { quantity: Number(e.target.value) || null })}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
          />
        </Box>
      )}

      <Box sx={{ mb: 2 }}>
        <Autocomplete
          size="small"
          fullWidth
          disabled={readOnly || stocksProduct}
          options={accountOptions}
          value={selectedAccount}
          onChange={(_e, picked) => patchLine(idx, { account_code: picked?.code ?? '' })}
          getOptionLabel={(o) => (o ? `${o.code} - ${o.name}` : '')}
          isOptionEqualToValue={(o, v) => o.code === v.code}
          getOptionDisabled={(o) => Boolean(o.__stale)}
          groupBy={accountGroup}
          renderGroup={(params) => (
            <li key={params.key}>
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  px: 2,
                  py: 0.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'text.secondary',
                }}
              >
                {params.group}
              </Typography>
              <ul style={{ padding: 0 }}>{params.children}</ul>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t($ => $.lines.expenseAccount)}
              placeholder={stocksProduct ? t($ => $.lines.booksToInventory) : t($ => $.lines.defaultExpenseAccount)}
              error={Boolean(errors.account_code)}
              helperText={errors.account_code}
            />
          )}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, alignItems: 'end' }}>
        <Box>
          <FormControl size="small" fullWidth disabled={readOnly}>
            <InputLabel>{t($ => $.lines.taxRate)}</InputLabel>
            <Select
              label={t($ => $.lines.taxRate)}
              value={TAX_RATES.includes(Number(line.tax_rate)) ? Number(line.tax_rate) : -1}
              onChange={(e) => patchLine(idx, { tax_rate: Number(e.target.value) })}
              renderValue={(v) => (v === -1 ? t($ => $.lines.select) : `${v}%`)}
            >
              {TAX_RATES.map((rate) => (
                <MenuItem key={rate} value={rate}>{rate}%</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
        <Box>
          <TextField
            label={t($ => $.labels.vatAmount)}
            size="small"
            fullWidth
            value={centsToEditableEuro(vatCents)}
            disabled
            slotProps={{ htmlInput: { style: { textAlign: 'right' } } }}
          />
        </Box>
        <Box>
          <MoneyInput
            label={t($ => $.labels.inclVat)}
            cents={line.amount_incl_cents}
            onChange={(c) => patchLine(idx, { amount_incl_cents: c })}
            disabled={readOnly}
            error={Boolean(errors.amount_incl_cents)}
            helperText={errors.amount_incl_cents}
            sx={{ width: '100%' }}
          />
        </Box>
      </Box>
    </Box>
  )
}

interface PurchaseLinesEditorProps {
  form: PurchaseForm
  totals: ReturnType<typeof computePurchaseTotals>
  accounts?: Account[]
  products?: Product[]
  lineErrors?: LineErrors[]
  readOnly?: boolean
  patchLine: (idx: number, patch: Partial<PurchaseFormLine>) => void
  addLine: () => void
  removeLine: (idx: number) => void
}

export default function PurchaseLinesEditor({ form, totals, accounts = [], products = [], lineErrors = [], readOnly, patchLine, addLine, removeLine }: PurchaseLinesEditorProps) {
  const { t } = useTranslation('purchases')
  return (
    <>
      {form.lines.map((line, idx) => (
        <PurchaseLineRow
          key={line._key}
          line={line}
          idx={idx}
          accounts={accounts}
          products={products}
          vatCents={totals.perLine[idx]?.vatCents || 0}
          errors={lineErrors[idx] || {}}
          readOnly={readOnly}
          canRemove={form.lines.length > 1}
          patchLine={patchLine}
          removeLine={removeLine}
        />
      ))}
      <Button size="small" startIcon={<AddIcon />} disabled={readOnly} onClick={addLine}>
        {t($ => $.lines.addLine)}
      </Button>
    </>
  )
}
