import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import MoneyInput from '../invoices/MoneyInput.tsx'
import { useAccountingProfile } from '../../contexts/accountingProfileContext.ts'
import VatRateSelect from '../shared/VatRateSelect.tsx'
import TaxCategorySelect from '../shared/TaxCategorySelect.tsx'
import { commonVatSelection, taxCategoryUsesZeroRate } from '../../../shared/taxCategories.js'
import type { Product, Account } from '../../types/entities.ts'

interface ProductBody {
  name: string
  default_price_incl_cents: number
  vat_rate: number
  tax_category_code: string | null
  tax_jurisdiction_code: string
  unit_cost_cents?: number
  revenue_account_code: string | null
}

interface ProductDialogProps {
  product?: Product
  revenueAccounts?: Account[]
  onSubmit: (body: ProductBody) => Promise<void>
  onClose: () => void
}

// Create or edit a product. The unit cost is a moving average maintained by
// purchase stock-ins, so it is only enterable at creation (as the starting
// cost for stock added before any purchase) and read-only afterwards.
export default function ProductDialog({ product, revenueAccounts = [], onSubmit, onClose }: Readonly<ProductDialogProps>) {
  const { t } = useTranslation(['merch', 'common'])
  const { accountingCountry, defaultVatRate } = useAccountingProfile()
  const [name, setName] = useState(product?.name ?? '')
  const [unitCostCents, setUnitCostCents] = useState(product?.unit_cost_cents ?? 0)
  const [priceInclCents, setPriceInclCents] = useState(product?.default_price_incl_cents ?? 0)
  const [vatRate, setVatRate] = useState(Number(product?.vat_rate ?? defaultVatRate))
  const initialTaxSelection = commonVatSelection(accountingCountry, product?.vat_rate ?? defaultVatRate)
  const [taxCategoryCode, setTaxCategoryCode] = useState<string | null>(
    product?.tax_category_code ?? initialTaxSelection?.tax_category_code ?? null,
  )
  const [taxJurisdictionCode, setTaxJurisdictionCode] = useState(
    product?.tax_jurisdiction_code ?? initialTaxSelection?.tax_jurisdiction_code ?? accountingCountry,
  )
  const [revenueAccountCode, setRevenueAccountCode] = useState(product?.revenue_account_code ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = Boolean(name.trim()) && !busy

  async function handleSubmit() {
    if (!canSubmit) return
    try {
      setBusy(true)
      setError(null)
      const body: ProductBody = {
        name: name.trim(),
        default_price_incl_cents: priceInclCents,
        vat_rate: vatRate,
        tax_category_code: taxCategoryCode,
        tax_jurisdiction_code: taxJurisdictionCode,
        // null clears the per-product account → sales fall back to the band default.
        revenue_account_code: revenueAccountCode || null,
      }
      // Once the product exists, purchases own the (moving average) cost.
      if (!product) body.unit_cost_cents = unitCostCents
      await onSubmit(body)
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{product ? t($ => $.productDialog.editTitle) : t($ => $.productDialog.newTitle)}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label={t($ => $.productDialog.name)}
            size="small"
            fullWidth
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <MoneyInput
            label={product ? t($ => $.productDialog.unitCost) : t($ => $.productDialog.startingUnitCost)}
            cents={unitCostCents}
            onChange={setUnitCostCents}
            disabled={Boolean(product)}
            helperText={product ? t($ => $.productDialog.movingAverageHelp) : undefined}
            sx={undefined}
          />
          <MoneyInput
            label={t($ => $.productDialog.sellingPrice)}
            cents={priceInclCents}
            onChange={setPriceInclCents}
            helperText={undefined}
            sx={undefined}
          />
          <VatRateSelect
            id="product-vat-rate"
            label={t($ => $.productDialog.vatRate)}
            country={accountingCountry}
            value={vatRate}
            categoryCode={taxCategoryCode}
            onChange={(rate, taxPatch) => {
              setVatRate(rate ?? 0)
              if (taxPatch) {
                setTaxCategoryCode(taxPatch.tax_category_code)
                setTaxJurisdictionCode(taxPatch.tax_jurisdiction_code)
              }
            }}
          />
          <TaxCategorySelect
            direction="sale"
            categoryCode={taxCategoryCode}
            jurisdictionCode={taxJurisdictionCode}
            defaultJurisdiction={accountingCountry}
            rate={vatRate}
            onChange={(patch) => {
              setTaxCategoryCode(patch.tax_category_code)
              setTaxJurisdictionCode(patch.tax_jurisdiction_code)
              if (patch.tax_category_code && taxCategoryUsesZeroRate(patch.tax_category_code, 'sale')) {
                setVatRate(0)
              }
            }}
          />
          {revenueAccounts.length > 0 && (
            <TextField
              label={t($ => $.productDialog.revenueAccount)}
              size="small"
              select
              value={revenueAccountCode}
              onChange={(e) => setRevenueAccountCode(e.target.value)}
              helperText={t($ => $.productDialog.revenueAccountHelp)}
            >
              <MenuItem value=""><em>{t($ => $.productDialog.revenueAccountDefault)}</em></MenuItem>
              {revenueAccounts.map((a) => (
                <MenuItem key={a.code} value={a.code}>{a.code} — {a.name}</MenuItem>
              ))}
            </TextField>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button>
        <Button variant="contained" disabled={!canSubmit} onClick={handleSubmit}>
          {product ? t($ => $.common.actions.save) : t($ => $.productDialog.create)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
