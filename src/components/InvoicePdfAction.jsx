import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import DownloadIcon from '@mui/icons-material/Download'
import RefreshIcon from '@mui/icons-material/Refresh'

export default function InvoicePdfAction({ invoice, onRetryRender }) {
  if (invoice.pdf_path) {
    return (
      <Tooltip title="Download PDF">
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
    <Tooltip title="PDF render failed - click to retry">
      <IconButton size="small" onClick={() => onRetryRender(invoice)}>
        <RefreshIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}
