import { useState } from 'react'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import { useTranslation } from 'react-i18next'
import { downloadGigArtistSettlement, downloadGigItinerary } from '../../gigs.ts'
import { downloadBlob } from '../../../../promotion/sharing/shareCard.ts'
import { useToast } from '../../../../contexts/toastContext.ts'
import type { Gig } from '../../../../types/entities.ts'

interface GigDocumentMenuProps {
  gig?: Gig
  canViewFinance?: boolean
}

// The gig's generated documents. One entry today (the itinerary), but it is a
// menu rather than a bare button because that is the shape the next document
// slots into — and it keeps the toolbar from growing an icon per format.
export default function GigDocumentMenu({ gig, canViewFinance = false }: Readonly<GigDocumentMenuProps>) {
  const { t, i18n } = useTranslation('gigs')
  const showToast = useToast()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [busy, setBusy] = useState(false)

  function handleOpen(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    setAnchorEl(e.currentTarget)
  }

  function handleClose() {
    setAnchorEl(null)
  }

  async function handleItinerary(e: React.MouseEvent) {
    e.stopPropagation()
    handleClose()
    if (!gig?.id || busy) return
    setBusy(true)
    try {
      // The server localizes the document, so it is told which language the
      // person asking for it is reading the app in.
      const { blob, filename } = await downloadGigItinerary(gig.id, i18n.language)
      downloadBlob(blob, filename)
    } catch {
      showToast?.(t($ => $.documentMenu.downloadFailed), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleArtistSettlement(e: React.MouseEvent) {
    e.stopPropagation()
    handleClose()
    if (!gig?.id || busy) return
    setBusy(true)
    try {
      const { blob, filename } = await downloadGigArtistSettlement(gig.id, i18n.language)
      downloadBlob(blob, filename)
    } catch {
      showToast?.(t($ => $.documentMenu.settlementDownloadFailed), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Tooltip title={t($ => $.documentMenu.documents)}>
        <IconButton
          size="small"
          aria-label={t($ => $.documentMenu.documentsAria)}
          onClick={handleOpen}
        >
          <DescriptionOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={handleClose}
        onClick={(e) => e.stopPropagation()}
        disableRestoreFocus
      >
        <MenuItem onClick={(e) => { void handleItinerary(e) }} disabled={busy}>
          <ListItemIcon><PictureAsPdfIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t($ => $.documentMenu.itinerary)}</ListItemText>
        </MenuItem>
        {canViewFinance && (
          <MenuItem onClick={(e) => { void handleArtistSettlement(e) }} disabled={busy}>
            <ListItemIcon><PictureAsPdfIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t($ => $.documentMenu.artistSettlement)}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  )
}
