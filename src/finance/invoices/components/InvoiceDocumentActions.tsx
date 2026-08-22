import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import DeleteIcon from '@mui/icons-material/Delete'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import { useCompactLayout } from '../../../hooks/useCompactLayout.ts'
import InvoiceDownloadMenu from './InvoiceDownloadMenu.tsx'
import { useInvoiceDownloadItems, type InvoiceDownloadItemsArgs } from './invoiceDownloadItems.tsx'

interface Props extends Omit<InvoiceDownloadItemsArgs, 'onClose'> {
  /** false ⇒ the viewer lacks finance.manage, so the mutations are withheld. */
  canWrite: boolean
  onOpenEmailDialog: () => void
  onRerenderPdf: () => void
  pdfRerenderBusy: boolean
  /**
   * Compact only: the overflow menu carries deleting too, because there is no
   * room for a separate footer action. On a wide screen the page owns it.
   */
  canDelete: boolean
  onDelete: () => void
  /** false ⇒ the editor is read-only, so there is nothing to save. */
  canSave: boolean
  onSave: () => void
  saving: boolean
}

const MENU_ID = 'invoice-actions-menu'
const BUTTON_ID = 'invoice-actions-button'

// The invoice's document actions plus saving, in one row. Wide: a labelled
// button each, save last. Compact: one overflow menu holding all of them, with
// the download entries folded in flat rather than nested behind a submenu.
// Deleting is deliberately absent from the wide row — it lives alone at the foot
// of the page, away from the actions used routinely — but it does appear at the
// bottom of the compact menu, which is the only action surface there.
export default function InvoiceDocumentActions({
  canWrite, onOpenEmailDialog, onRerenderPdf, pdfRerenderBusy,
  canDelete, onDelete, canSave, onSave, saving,
  ...downloads
}: Readonly<Props>) {
  const { t } = useTranslation(['invoices', 'common'])
  const isCompact = useCompactLayout()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const open = Boolean(anchorEl)
  const close = () => setAnchorEl(null)
  const downloadItems = useInvoiceDownloadItems({ ...downloads, onClose: close })
  const canRerender = Boolean(downloads.pdfPath) && canWrite
  const saveLabel = saving ? t($ => $.detail.saving) : t($ => $.detail.saveChanges)
  const run = (action: () => void) => () => { close(); action() }

  if (!isCompact) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', justifyContent: 'flex-end' }}>
        <InvoiceDownloadMenu {...downloads} />
        {canWrite && (
          <Button size="small" startIcon={<SendOutlinedIcon />} onClick={onOpenEmailDialog}>
            {t($ => $.detail.send)}
          </Button>
        )}
        {canRerender && (
          <Button
            size="small"
            startIcon={pdfRerenderBusy ? <CircularProgress size={16} /> : <RefreshIcon />}
            onClick={onRerenderPdf}
            disabled={pdfRerenderBusy}
          >
            {t($ => $.detail.regenerate)}
          </Button>
        )}
        {canSave && (
          <Button size="small" startIcon={<SaveOutlinedIcon />} onClick={onSave} disabled={saving}>
            {saveLabel}
          </Button>
        )}
      </Box>
    )
  }

  return (
    <>
      <IconButton
        id={BUTTON_ID}
        size="small"
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-label={t($ => $.detail.documentActions)}
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-controls={open ? MENU_ID : undefined}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>

      <Menu
        id={MENU_ID}
        anchorEl={anchorEl}
        open={open}
        onClose={close}
        slotProps={{ list: { 'aria-labelledby': BUTTON_ID } }}
      >
        {canSave && (
          <MenuItem key="save" onClick={run(onSave)} disabled={saving}>
            <ListItemIcon><SaveOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{saveLabel}</ListItemText>
          </MenuItem>
        )}
        {canSave && <Divider key="save-divider" />}
        {downloadItems}
        {canWrite && (
          <MenuItem key="send" onClick={run(onOpenEmailDialog)}>
            <ListItemIcon><SendOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t($ => $.detail.send)}</ListItemText>
          </MenuItem>
        )}
        {canRerender && (
          <MenuItem key="regenerate" onClick={run(onRerenderPdf)} disabled={pdfRerenderBusy}>
            <ListItemIcon>
              {pdfRerenderBusy ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{t($ => $.detail.regenerate)}</ListItemText>
          </MenuItem>
        )}
        {/* Last, and behind a divider: the destructive one must not sit under a
            thumb reaching for Regenerate. */}
        {canDelete && <Divider key="delete-divider" />}
        {canDelete && (
          <MenuItem key="delete" onClick={run(onDelete)} sx={{ color: 'error.main' }}>
            <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>{t($ => $.common.actions.delete)}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  )
}
