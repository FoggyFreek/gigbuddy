import type { Invoice } from '../types/entities.ts'
import { useTranslation } from 'react-i18next'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import DownloadIcon from '@mui/icons-material/Download'
import RefreshIcon from '@mui/icons-material/Refresh'

interface InvoicePdfActionProps {
  invoice: Invoice
  onRetryRender: (invoice: Invoice) => void
}

export default function InvoicePdfAction({ invoice, onRetryRender }: InvoicePdfActionProps) {
  const { t } = useTranslation('invoices')
  if (invoice.pdf_path) {
    return (
      <Tooltip title={t($ => $.pdf.download)}>
        <IconButton
          size="small"
          component="a"
          href={`/api/files/${invoice.pdf_path}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    )
  }

  return (
    <Tooltip title={t($ => $.pdf.retry)}>
      <IconButton size="small" onClick={() => onRetryRender(invoice)}>
        <RefreshIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}
