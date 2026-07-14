import type { InvoiceStatus } from '../../types/entities.ts'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import type { ButtonProps } from '@mui/material/Button'
import { INVOICE_STATUS_TRANSITIONS } from '../../utils/invoiceStatus.ts'

interface InvoiceStatusActionsProps {
  status: InvoiceStatus
  disabled?: boolean
  onStatusChange: (status: InvoiceStatus) => void
}

// One button per allowed forward transition from the current status. The button
// only opens the change: the confirmation dialogs (see useInvoiceFormState) spell
// out the consequences before anything is PATCHed.
const ACTION_STYLE: Record<InvoiceStatus, Pick<ButtonProps, 'color' | 'variant'>> = {
  draft: { color: 'inherit', variant: 'outlined' },
  sent: { color: 'primary', variant: 'contained' },
  paid: { color: 'success', variant: 'outlined' },
  void: { color: 'error', variant: 'outlined' },
}

export default function InvoiceStatusActions({ status, disabled, onStatusChange }: Readonly<InvoiceStatusActionsProps>) {
  const { t } = useTranslation('invoices')
  const targets = INVOICE_STATUS_TRANSITIONS[status] ?? []
  if (!targets.length) return null

  const label = (target: InvoiceStatus) => {
    switch (target) {
      case 'sent': return t($ => $.statusActions.markSent)
      case 'paid': return t($ => $.statusActions.markPaid)
      case 'void': return t($ => $.statusActions.void)
      default: return t($ => $.state[target])
    }
  }

  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      {targets.map((target) => (
        <Button
          key={target}
          size="small"
          color={ACTION_STYLE[target].color}
          variant={ACTION_STYLE[target].variant}
          disabled={disabled}
          onClick={() => onStatusChange(target)}
        >
          {label(target)}
        </Button>
      ))}
    </Box>
  )
}
