import { useState } from 'react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Snackbar from '@mui/material/Snackbar'
import ShareIcon from '@mui/icons-material/Share'
import IosShareIcon from '@mui/icons-material/IosShare'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import FacebookIcon from '@mui/icons-material/Facebook'
import XIcon from '@mui/icons-material/X'
import TelegramIcon from '@mui/icons-material/Telegram'
import EmailIcon from '@mui/icons-material/Email'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'

// Match the page's system font instead of MUI's Roboto default.
const theme = createTheme({ typography: { fontFamily: 'inherit' } })

// The social/chat channels a page URL can be shared to. Each opens the
// platform's share intent in a new tab; `text` rides along where supported.
const CHANNELS = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    Icon: WhatsAppIcon,
    href: (url, text) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    Icon: FacebookIcon,
    href: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    id: 'x',
    label: 'X',
    Icon: XIcon,
    href: (url, text) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    Icon: TelegramIcon,
    href: (url, text) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    id: 'email',
    label: 'Email',
    Icon: EmailIcon,
    href: (url, text) => `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(url)}`,
  },
]

// Share menu for a page URL. `variant="floating"` pins it to the top-right of
// the viewport (public pages); `variant="inline"` renders a plain icon button
// (editor header). `onShare(channel)` reports the chosen channel — the public
// page wires it to the click beacon so shares show up in the statistics.
export default function ShareButton({ url, title, onShare = () => {}, variant = 'floating' }) {
  const [anchorEl, setAnchorEl] = useState(null)
  const [copied, setCopied] = useState(false)

  const close = () => setAnchorEl(null)

  const nativeShare = async () => {
    close()
    onShare('native')
    try {
      await navigator.share({ title, url })
    } catch {
      /* visitor dismissed the sheet */
    }
  }

  const openChannel = (channel) => {
    close()
    onShare(channel.id)
    const href = channel.href(url, title)
    if (channel.id === 'email') {
      window.location.href = href
    } else {
      window.open(href, '_blank', 'noopener')
    }
  }

  const copyLink = async () => {
    close()
    onShare('copy')
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      /* clipboard unavailable (http, permissions) — the menu already closed */
    }
  }

  const floatingSx = {
    position: 'fixed',
    top: 12,
    right: 12,
    zIndex: 10,
    bgcolor: '#ffffff',
    boxShadow: '0 1px 3px rgb(20 22 26 / 0.15)',
    '&:hover': { bgcolor: '#f4f5f7' },
  }

  return (
    <ThemeProvider theme={theme}>
      <IconButton
        aria-label="Share this page"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={variant === 'floating' ? floatingSx : undefined}
        size={variant === 'floating' ? 'medium' : 'small'}
      >
        <ShareIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
          <MenuItem onClick={nativeShare}>
            <ListItemIcon><IosShareIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Share…</ListItemText>
          </MenuItem>
        )}
        {CHANNELS.map((channel) => (
          <MenuItem key={channel.id} onClick={() => openChannel(channel)}>
            <ListItemIcon><channel.Icon fontSize="small" /></ListItemIcon>
            <ListItemText>{channel.label}</ListItemText>
          </MenuItem>
        ))}
        <MenuItem onClick={copyLink}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Copy link</ListItemText>
        </MenuItem>
      </Menu>
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message="Link copied"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </ThemeProvider>
  )
}
