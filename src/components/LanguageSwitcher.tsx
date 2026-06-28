import { useState } from 'react'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Check from '@mui/icons-material/Check'
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown'

function DutchFlag() {
  return (
    <Box
      component="svg"
      viewBox="0 0 9 6"
      sx={{ width: 22, height: 'auto', borderRadius: '2px', display: 'block', boxShadow: '0 0 0 1px rgba(0,0,0,0.1)' }}
      role="img"
      aria-hidden="true"
    >
      <rect width="9" height="6" fill="#21468B" />
      <rect width="9" height="4" fill="#FFFFFF" />
      <rect width="9" height="2" fill="#AE1C28" />
    </Box>
  )
}

function UnionJackFlag() {
  return (
    <Box
      component="svg"
      viewBox="0 0 60 30"
      sx={{ width: 22, height: 'auto', borderRadius: '2px', display: 'block', boxShadow: '0 0 0 1px rgba(0,0,0,0.1)' }}
      role="img"
      aria-hidden="true"
    >
      <clipPath id="union-jack-clip">
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <clipPath id="union-jack-diag">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <g clipPath="url(#union-jack-clip)">
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#union-jack-diag)" stroke="#C8102E" strokeWidth="4" />
        <path d="M30,0 v30 M0,15 h60" stroke="#FFFFFF" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </Box>
  )
}

const languages = [
  { code: 'nl', label: 'Nederlands', Flag: DutchFlag },
  { code: 'en', label: 'English', Flag: UnionJackFlag },
] as const

export default function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const open = Boolean(anchorEl)

  const current = languages.find((l) => l.code === i18n.resolvedLanguage) ?? languages[1]
  const CurrentFlag = current.Flag

  const handleOpen = (event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)
  const handleClose = () => setAnchorEl(null)
  const selectLanguage = (code: string) => {
    void i18n.changeLanguage(code)
    handleClose()
  }

  return (
    <>
      <Button
        onClick={handleOpen}
        startIcon={<CurrentFlag />}
        endIcon={<KeyboardArrowDown />}
        aria-haspopup="menu"
        aria-expanded={open}
        sx={{
          color: 'text.secondary',
          textTransform: 'none',
          fontWeight: 500,
          borderRadius: 2,
          px: 1.5,
        }}
      >
        {current.label}
      </Button>
      <Menu anchorEl={anchorEl} open={open} onClose={handleClose}>
        {languages.map(({ code, label, Flag }) => (
          <MenuItem key={code} selected={code === current.code} onClick={() => selectLanguage(code)}>
            <ListItemIcon>
              <Flag />
            </ListItemIcon>
            <ListItemText primary={label} />
            {code === current.code && <Check fontSize="small" sx={{ ml: 2, color: 'text.secondary' }} />}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
