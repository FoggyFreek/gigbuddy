import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import CodeIcon from '@mui/icons-material/Code'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { PeppolWarning } from '../peppolReadiness.ts'

export interface InvoiceDownloadItemsArgs {
  /** Object key of the rendered PDF; absent until one has been generated. */
  pdfPath?: string | null
  onDownloadUbl: () => void
  onDownloadUblWithPdf: () => void
  ublBusy: boolean
  /** Blocking Peppol warnings, annotated onto the UBL entry. */
  peppolBlockers: PeppolWarning[]
  /** Closes whichever menu is hosting these items. */
  onClose: () => void
}

// The download entries themselves, separated from the control that opens them:
// on a wide screen they hang off their own Download button, on a compact one they
// are folded into the single overflow menu. One definition, so the two can never
// drift apart.
export function useInvoiceDownloadItems({
  pdfPath, onDownloadUbl, onDownloadUblWithPdf, ublBusy, peppolBlockers, onClose,
}: InvoiceDownloadItemsArgs): ReactNode[] {
  const { t } = useTranslation('invoices')
  // Close before acting: an action may open a dialog, and leaving the menu
  // mounted would trap focus behind it.
  const choose = (action: () => void) => () => {
    onClose()
    action()
  }
  const notReady = peppolBlockers.length > 0
  const warningDetail = peppolBlockers.map((w) => t($ => $.ubl.warnings[w.code]))

  return [
    // Only offered once a PDF has actually been rendered.
    pdfPath ? (
      <MenuItem
        key="pdf"
        component="a"
        href={`/api/files/${pdfPath}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClose}
      >
        <ListItemIcon><PictureAsPdfIcon fontSize="small" /></ListItemIcon>
        <ListItemText>{t($ => $.pdf.download)}</ListItemText>
      </MenuItem>
    ) : null,

    <MenuItem key="ubl" onClick={choose(onDownloadUbl)} disabled={ublBusy}>
      <ListItemIcon><CodeIcon fontSize="small" /></ListItemIcon>
      <ListItemText
        primary={t($ => $.ubl.download)}
        // The warning belongs where the action is: it only matters to
        // someone about to send this file to an e-invoicing network.
        secondary={notReady ? t($ => $.ubl.notReadyTitle) : undefined}
        slotProps={{ secondary: { sx: { color: 'warning.main' } } }}
      />
      {notReady && (
        <Tooltip
          title={(
            <>
              {t($ => $.ubl.notReadyIntro)}
              <Box component="ul" sx={{ pl: 2, m: 0 }}>
                {peppolBlockers.map((w) => <li key={w.code}>{t($ => $.ubl.warnings[w.code])}</li>)}
              </Box>
            </>
          )}
        >
          {/* The tooltip is pointer-only, so the label carries the same
              detail for screen readers and keyboard users. */}
          <WarningAmberIcon
            fontSize="small"
            aria-label={`${t($ => $.ubl.notReadyTitle)}: ${warningDetail.join(' ')}`}
            sx={{ color: 'warning.main', ml: 1 }}
          />
        </Tooltip>
      )}
    </MenuItem>,

    <MenuItem key="ubl-pdf" onClick={choose(onDownloadUblWithPdf)} disabled={ublBusy}>
      <ListItemIcon><CodeIcon fontSize="small" /></ListItemIcon>
      <ListItemText>{t($ => $.ubl.downloadWithPdf)}</ListItemText>
    </MenuItem>,
  ].filter(Boolean)
}
