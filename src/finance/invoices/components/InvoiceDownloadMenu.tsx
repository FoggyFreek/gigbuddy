import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import CodeIcon from '@mui/icons-material/Code'
import DownloadIcon from '@mui/icons-material/Download'
import EmailIcon from '@mui/icons-material/Email'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { PeppolWarning } from '../peppolReadiness.ts'

interface Props {
  /** Object key of the rendered PDF; absent until one has been generated. */
  pdfPath?: string | null
  onDownloadUbl: () => void
  onDownloadUblWithPdf: () => void
  ublBusy: boolean
  /** The email download composes a personal message first, so it opens a dialog. */
  onOpenEmailDialog: () => void
  /** Blocking Peppol warnings, annotated onto the UBL entry. */
  peppolBlockers: PeppolWarning[]
}

const MENU_ID = 'invoice-download-menu'
const BUTTON_ID = 'invoice-download-button'

// The ways an invoice leaves the app, behind one control. All are reads,
// so they stay available to every finance viewer; re-generating the PDF is a
// mutation and deliberately lives outside this menu.
export default function InvoiceDownloadMenu({
  pdfPath,
  onDownloadUbl,
  onDownloadUblWithPdf,
  ublBusy,
  onOpenEmailDialog,
  peppolBlockers,
}: Readonly<Props>) {
  const { t } = useTranslation('invoices')
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const open = Boolean(anchorEl)

  const close = () => setAnchorEl(null)
  // Close before acting: the email option opens a dialog, and leaving the menu
  // mounted would trap focus behind it.
  const choose = (action: () => void) => () => {
    close()
    action()
  }

  const notReady = peppolBlockers.length > 0
  const warningDetail = peppolBlockers.map((w) => t($ => $.ubl.warnings[w.code]))

  return (
    <>
      <Button
        id={BUTTON_ID}
        startIcon={<DownloadIcon />}
        endIcon={<ArrowDropDownIcon />}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-controls={open ? MENU_ID : undefined}
      >
        {t($ => $.detail.download)}
      </Button>

      <Menu
        id={MENU_ID}
        anchorEl={anchorEl}
        open={open}
        onClose={close}
        slotProps={{ list: { 'aria-labelledby': BUTTON_ID } }}
      >
        {/* Only offered once a PDF has actually been rendered. */}
        {pdfPath && (
          <MenuItem
            component="a"
            href={`/api/files/${pdfPath}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
          >
            <ListItemIcon><PictureAsPdfIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t($ => $.pdf.download)}</ListItemText>
          </MenuItem>
        )}

        <MenuItem onClick={choose(onDownloadUbl)} disabled={ublBusy}>
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
        </MenuItem>

        <MenuItem onClick={choose(onDownloadUblWithPdf)} disabled={ublBusy}>
          <ListItemIcon><CodeIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t($ => $.ubl.downloadWithPdf)}</ListItemText>
        </MenuItem>

        <MenuItem onClick={choose(onOpenEmailDialog)}>
          <ListItemIcon><EmailIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t($ => $.detail.downloadEmail)}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}
