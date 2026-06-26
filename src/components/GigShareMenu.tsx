import { useState } from 'react'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Tooltip from '@mui/material/Tooltip'
import ShareIcon from '@mui/icons-material/Share'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import ImageIcon from '@mui/icons-material/Image'
import { useTranslation } from 'react-i18next'
import GigShareDialog from './GigShareDialog.tsx'
import { gigShareUrl } from '../utils/shareUtils.ts'
import type { Gig } from '../types/entities.ts'

interface GigShareMenuProps {
  gig?: Gig
}

export default function GigShareMenu({ gig }: GigShareMenuProps) {
  const { t } = useTranslation('gigs')
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  function handleOpen(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    setAnchorEl(e.currentTarget)
  }

  function handleClose() {
    setAnchorEl(null)
  }

  function handleWhatsApp(e: React.MouseEvent) {
    e.stopPropagation()
    if (gig) window.open(gigShareUrl(gig), '_blank')
    handleClose()
  }

  function handleImageCard(e: React.MouseEvent) {
    e.stopPropagation()
    setDialogOpen(true)
    handleClose()
  }

  return (
    <>
      <Tooltip title={t($ => $.shareMenu.share)}>
        <IconButton size="small" aria-label={t($ => $.shareMenu.shareGigAria)} onClick={handleOpen}>
          <ShareIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={handleClose}
        onClick={(e) => e.stopPropagation()}
        disableRestoreFocus
      >
        <MenuItem onClick={handleWhatsApp}>
          <ListItemIcon><WhatsAppIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t($ => $.shareMenu.whatsApp)}</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleImageCard}>
          <ListItemIcon><ImageIcon fontSize="small" /></ListItemIcon>
          <ListItemText>{t($ => $.shareMenu.imageCard)}</ListItemText>
        </MenuItem>
      </Menu>
      <GigShareDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        gig={gig}
      />
    </>
  )
}
