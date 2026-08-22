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
import {
  downloadGigArtistSettlement,
  downloadGigContract,
  downloadGigItinerary,
  type GigDocumentFile,
} from '../../gigs.ts'
import { downloadBlob } from '../../../../promotion/sharing/shareCard.ts'
import { useToast } from '../../../../contexts/toastContext.ts'
import type { Gig } from '../../../../types/entities.ts'

interface GigDocumentMenuProps {
  gig?: Gig
  canViewFinance?: boolean
}

type DocumentDownloader = (gigId: NonNullable<Gig['id']>, lng: string) => Promise<GigDocumentFile>

// The gig's live generated documents share one compact download surface and
// one error-handling path. None of these files are persisted by the server.
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

  async function handleDownload(
    e: React.MouseEvent,
    downloader: DocumentDownloader,
    failureMessage: string,
  ) {
    e.stopPropagation()
    handleClose()
    if (!gig?.id || busy) return
    setBusy(true)
    try {
      const { blob, filename } = await downloader(gig.id, i18n.language)
      downloadBlob(blob, filename)
    } catch {
      showToast?.(failureMessage, 'error')
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
        <MenuItem onClick={(e) => { void handleDownload(e, downloadGigItinerary, t($ => $.documentMenu.downloadFailed)) }} disabled={busy}>
          <ListItemIcon><PictureAsPdfIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t($ => $.documentMenu.itinerary)}</ListItemText>
        </MenuItem>
        {canViewFinance && (
          <MenuItem onClick={(e) => { void handleDownload(e, downloadGigArtistSettlement, t($ => $.documentMenu.settlementDownloadFailed)) }} disabled={busy}>
            <ListItemIcon><PictureAsPdfIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t($ => $.documentMenu.artistSettlement)}</ListItemText>
          </MenuItem>
        )}
        {canViewFinance && (
          <MenuItem onClick={(e) => { void handleDownload(e, downloadGigContract, t($ => $.documentMenu.contractDownloadFailed)) }} disabled={busy}>
            <ListItemIcon><PictureAsPdfIcon fontSize="small" /></ListItemIcon>
            <ListItemText>{t($ => $.documentMenu.contract)}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  )
}
