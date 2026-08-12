import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Typography from '@mui/material/Typography'
import { formatEur } from '../../../invoices/invoiceTotals.ts'
import { formatShortDate } from '../../../../utils/dateFormat.ts'
import type { Account, BankStatementLine } from '../../../../types/entities.ts'
import type { Decision } from './decisions.ts'

type PayoutDecision = Extract<Decision, { kind: 'reconcile_shopify_payout' | 'reconcile_paypal_payout' }>

interface Props {
  line: BankStatementLine
  decision: PayoutDecision
  accounts: Account[]
  onChange: (decision: Decision) => void
  onClose: () => void
}

// The multi-field half of a payout reconciliation — which P&L account each
// non-order Shopify adjustment lands on, or which PayPal orders make up the
// deposit and where the fee difference goes. It cannot live in a grid cell, so
// the grid's account column opens this instead.
export default function PayoutMappingDialog({ line, decision, accounts, onChange, onClose }: Readonly<Props>) {
  const { t } = useTranslation('ledger')
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t($ => $.bankImport.mapping.title)}</DialogTitle>
      <DialogContent dividers>
        {decision.kind === 'reconcile_shopify_payout'
          ? <ShopifyMapping line={line} decision={decision} accounts={accounts} onChange={onChange} />
          : <PaypalMapping line={line} decision={decision} accounts={accounts} onChange={onChange} />}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>{t($ => $.bankImport.mapping.done)}</Button>
      </DialogActions>
    </Dialog>
  )
}

interface ShopifyProps {
  line: BankStatementLine
  decision: Extract<Decision, { kind: 'reconcile_shopify_payout' }>
  accounts: Account[]
  onChange: (decision: Decision) => void
}

function ShopifyMapping({ line, decision, accounts, onChange }: Readonly<ShopifyProps>) {
  const { t } = useTranslation('ledger')
  const payout = (line.suggestion.shopifyPayoutMatches ?? [])
    .find((candidate) => candidate.id === decision.payoutId)

  if (!payout?.adjustments.length) {
    return <Typography variant="body2">{t($ => $.bankImport.mapping.nothingToMap)}</Typography>
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t($ => $.bankImport.shopify.adjustmentsIntro)}
      </Typography>
      {payout.adjustments.map((adjustment) => (
        <FormControl size="small" key={String(adjustment.id)} fullWidth>
          <InputLabel>{adjustment.type}</InputLabel>
          <Select
            label={adjustment.type}
            value={decision.adjustmentMappings[String(adjustment.id)] ?? ''}
            onChange={(event) => onChange({
              ...decision,
              adjustmentMappings: {
                ...decision.adjustmentMappings,
                [String(adjustment.id)]: event.target.value,
              },
            })}
          >
            {accounts.map((account) => (
              <MenuItem key={`${adjustment.id}-${account.code}`} value={account.code}>
                {account.code} — {account.name} ({formatEur(adjustment.net_cents)})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      ))}
    </Box>
  )
}

interface PaypalProps {
  line: BankStatementLine
  decision: Extract<Decision, { kind: 'reconcile_paypal_payout' }>
  accounts: Account[]
  onChange: (decision: Decision) => void
}

function PaypalMapping({ line, decision, accounts, onChange }: Readonly<PaypalProps>) {
  const { t } = useTranslation('ledger')
  const candidates = line.suggestion.paypalOrderMatches ?? []
  const selected = new Set(decision.orderFinancialIds.map(String))
  const gross = candidates
    .filter((order) => selected.has(String(order.id)))
    .reduce((sum, order) => sum + order.gross_cents, 0)
  const difference = gross - line.amount_cents

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormControl size="small" fullWidth>
        <InputLabel>{t($ => $.bankImport.paypal.orders)}</InputLabel>
        <Select
          multiple
          label={t($ => $.bankImport.paypal.orders)}
          value={decision.orderFinancialIds.map(String)}
          onChange={(event) => {
            const raw = event.target.value
            const values = typeof raw === 'string' ? raw.split(',') : raw
            onChange({ ...decision, orderFinancialIds: values.map((value) => Number(value)) })
          }}
          renderValue={(values) => t($ => $.bankImport.paypal.selectedOrders, { count: values.length })}
        >
          {candidates.map((order) => (
            <MenuItem key={String(order.id)} value={String(order.id)}>
              <Checkbox checked={selected.has(String(order.id))} />
              {order.order_name} · {formatShortDate(order.processed_at)} · {formatEur(order.gross_cents)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="body2">
        {t($ => $.bankImport.paypal.summary, {
          gross: formatEur(gross),
          deposit: formatEur(line.amount_cents),
          difference: formatEur(difference),
        })}
      </Typography>
      {difference !== 0 && (
        <FormControl size="small" fullWidth>
          <InputLabel>{t($ => $.bankImport.paypal.differenceAccount)}</InputLabel>
          <Select
            label={t($ => $.bankImport.paypal.differenceAccount)}
            value={decision.differenceAccountCode}
            onChange={(event) => onChange({ ...decision, differenceAccountCode: event.target.value })}
          >
            {accounts.map((account) => (
              <MenuItem key={`paypal-${account.code}`} value={account.code}>
                {account.code} — {account.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </Box>
  )
}
