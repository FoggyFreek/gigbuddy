import { useEffect, useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import DateEntryField from '../DateEntryField.tsx'
import MoneyInput from '../invoices/MoneyInput.tsx'
import { listGigs } from '../../api/gigs.ts'
import { formatEur } from '../../utils/purchaseTotals.ts'
import { VAT_RATES } from './vatRates.ts'
import type { Product, Gig, Id } from '../../types/entities.ts'

interface SaleBody {
  product_id: Id
  quantity: number
  unit_price_incl_cents: number
  vat_rate: number
  sale_date: string
  payment_method: string
  gig_id: Id | null
}

interface RecordSaleDialogProps {
  products: Product[]
  onSubmit: (body: SaleBody) => Promise<void>
  onClose: () => void
}

// Records a merch sale. Picking a product prefills its default price and VAT
// rate (both editable per sale). The gig link is optional context only.
export default function RecordSaleDialog({ products, onSubmit, onClose }: RecordSaleDialogProps) {
  const sellable = useMemo(() => products.filter((p) => !p.archived_at), [products])
  const [productId, setProductId] = useState<Id | ''>('')
  const [quantity, setQuantity] = useState<number | string>(1)
  const [priceInclCents, setPriceInclCents] = useState(0)
  const [vatRate, setVatRate] = useState(21)
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paymentMethod, setPaymentMethod] = useState('bank')
  const [gigId, setGigId] = useState<Id | ''>('')
  const [gigs, setGigs] = useState<Gig[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    listGigs()
      .then((rows) => active && setGigs(rows))
      .catch(() => {})
    return () => { active = false }
  }, [])

  const product = sellable.find((p) => p.id === productId) || null

  function handleProductChange(id: Id) {
    setProductId(id)
    const next = sellable.find((p) => p.id === id)
    if (next) {
      setPriceInclCents(next.default_price_incl_cents ?? 0)
      setVatRate(Number(next.vat_rate))
    }
  }

  const qty = Number(quantity)
  const validQty = Number.isInteger(qty) && qty > 0
  const canSubmit = Boolean(product) && validQty && Boolean(saleDate) && !busy

  async function handleSubmit() {
    if (!canSubmit || !product) return
    try {
      setBusy(true)
      setError(null)
      await onSubmit({
        product_id: product.id!,
        quantity: qty,
        unit_price_incl_cents: priceInclCents,
        vat_rate: vatRate,
        sale_date: saleDate,
        payment_method: paymentMethod,
        gig_id: gigId || null,
      })
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Record merch sale</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label="Product"
            size="small"
            select
            value={productId}
            onChange={(e) => handleProductChange(e.target.value)}
          >
            {sellable.map((p) => (
              <MenuItem key={String(p.id)} value={p.id}>
                {p.name} ({p.quantity_on_hand} on hand)
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Quantity"
            size="small"
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            error={!validQty}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
          />
          <MoneyInput
            label="Unit price (incl. VAT)"
            cents={priceInclCents}
            onChange={setPriceInclCents}
            helperText={undefined}
            sx={undefined}
          />
          <TextField
            label="VAT rate"
            size="small"
            select
            value={vatRate}
            onChange={(e) => setVatRate(Number(e.target.value))}
          >
            {VAT_RATES.map((rate) => (
              <MenuItem key={rate} value={rate}>{rate}%</MenuItem>
            ))}
          </TextField>
          <DateEntryField
            label="Sale date"
            size="small"
            fullWidth
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
            sx={undefined}
          />
          <TextField
            label="Paid into"
            size="small"
            select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
          >
            <MenuItem value="bank">Bank account</MenuItem>
            <MenuItem value="cash">Cash on hand</MenuItem>
          </TextField>
          <TextField
            label="Gig (optional)"
            size="small"
            select
            value={gigId}
            onChange={(e) => setGigId(e.target.value)}
          >
            <MenuItem value="">None</MenuItem>
            {gigs.map((g) => (
              <MenuItem key={String(g.id)} value={g.id}>
                {String(g.event_date ?? '').slice(0, 10)} — {g.event_description}
              </MenuItem>
            ))}
          </TextField>
          {product && validQty && (
            <Typography variant="body2" color="text.secondary">
              Customer pays {formatEur(qty * priceInclCents)}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={!canSubmit} onClick={handleSubmit}>
          Record sale
        </Button>
      </DialogActions>
    </Dialog>
  )
}
