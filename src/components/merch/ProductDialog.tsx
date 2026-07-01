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
import { VAT_RATES } from './vatRates.ts'
import type { Product, Account } from '../../types/entities.ts'

interface ProductBody {
  name: string
  default_price_incl_cents: number
  vat_rate: number
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
  const [name, setName] = useState(product?.name ?? '')
  const [unitCostCents, setUnitCostCents] = useState(product?.unit_cost_cents ?? 0)
  const [priceInclCents, setPriceInclCents] = useState(product?.default_price_incl_cents ?? 0)
  const [vatRate, setVatRate] = useState(Number(product?.vat_rate ?? 21))
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
          <TextField
            label={t($ => $.productDialog.vatRate)}
            size="small"
            select
            value={vatRate}
            onChange={(e) => setVatRate(Number(e.target.value))}
          >
            {VAT_RATES.map((rate) => (
              <MenuItem key={rate} value={rate}>{rate}%</MenuItem>
            ))}
          </TextField>
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
