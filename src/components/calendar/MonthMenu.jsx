import { useCallback, useEffect, useId, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import '@material/web/menu/menu.js'
import '@material/web/menu/menu-item.js'
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'
import { MONTH_NAMES } from './calendarGrid.js'

export default function MonthMenu({ year, month, onMonthJump }) {
  const anchorRef = useRef(null)
  const menuRef = useRef(null)
  const [open, setOpen] = useState(false)
  const theme = useTheme()
  const uid = useId().replaceAll(':', '')

  const toggle = useCallback(() => setOpen((v) => !v), [])

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return undefined
    const onClosed = () => setOpen(false)
    menu.addEventListener('closed', onClosed)
    return () => menu.removeEventListener('closed', onClosed)
  }, [])

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    menu.open = open
  }, [open])

  const handleSelect = useCallback((e) => {
    const idx = Number(e.currentTarget.dataset.idx)
    setOpen(false)
    onMonthJump(year, idx + 1)
  }, [year, onMonthJump])

  return (
    <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        ref={anchorRef}
        id={uid}
        onClick={toggle}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: '1rem',
          fontWeight: 600,
          padding: '4px 8px',
          borderRadius: 4,
          minWidth: 140,
          textAlign: 'center',
          color: theme.palette.text.primary,
        }}
      >
        {MONTH_NAMES[month - 1]} {year}
      </button>
      <md-menu
        ref={menuRef}
        anchor={uid}
        positioning="absolute"
        quick
      >
        {MONTH_NAMES.map((name, i) => (
          <md-menu-item
            key={i}
            data-idx={i}
            selected={i === month - 1}
            onClick={handleSelect}
          >
            <div slot="headline">{name}</div>
          </md-menu-item>
        ))}
      </md-menu>
    </Box>
  )
}

MonthMenu.propTypes = {
  year: PropTypes.number.isRequired,
  month: PropTypes.number.isRequired,
  onMonthJump: PropTypes.func.isRequired,
}
