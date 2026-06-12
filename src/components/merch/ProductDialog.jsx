import { useState } from 'react'
import PropTypes from 'prop-types'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import MoneyInput from '../invoices/MoneyInput.jsx'
import { VAT_RATES } from './vatRates.js'
import { productShape } from '../../propTypes/shared.js'

// Create or edit a product. The unit cost is a moving average maintained by
// purchase stock-ins, so it is only enterable at creation (as the starting
// cost for stock added before any purchase) and read-only afterwards.
export default function ProductDialog({ product, onSubmit, onClose }) {
  const [name, setName] = useState(product?.name ?? '')
  const [unitCostCents, setUnitCostCents] = useState(product?.unit_cost_cents ?? 0)
  const [priceInclCents, setPriceInclCents] = useState(product?.default_price_incl_cents ?? 0)
  const [vatRate, setVatRate] = useState(Number(product?.vat_rate ?? 21))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const canSubmit = Boolean(name.trim()) && !busy

  async function handleSubmit() {
    if (!canSubmit) return
    try {
      setBusy(true)
      setError(null)
      const body = {
        name: name.trim(),
        default_price_incl_cents: priceInclCents,
        vat_rate: vatRate,
      }
      // Once the product exists, purchases own the (moving average) cost.
      if (!product) body.unit_cost_cents = unitCostCents
      await onSubmit(body)
      onClose()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{product ? 'Edit product' : 'New product'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            label="Name"
            size="small"
            fullWidth
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <MoneyInput
            label={product ? 'Unit cost (excl. VAT)' : 'Starting unit cost (excl. VAT)'}
            cents={unitCostCents}
            onChange={setUnitCostCents}
            disabled={Boolean(product)}
            helperText={product ? 'Moving average — updated automatically by purchases' : undefined}
          />
          <MoneyInput
            label="Selling price (incl. VAT)"
            cents={priceInclCents}
            onChange={setPriceInclCents}
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
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={!canSubmit} onClick={handleSubmit}>
          {product ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

ProductDialog.propTypes = {
  product: productShape,
  onSubmit: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
}
