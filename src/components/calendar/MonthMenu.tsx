import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import '@material/web/menu/menu.js'
import '@material/web/menu/menu-item.js'
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'
import { getMonthNames } from './calendarGrid.ts'

// Declare the Material Web components used here so TSX doesn't complain about
// unknown JSX element names. We use module augmentation on ReactDOM instead of
// global JSX namespace (avoids conflicts with React's intrinsicElements).
declare module 'react' {
  // JSX intrinsic-element augmentation genuinely requires the JSX namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'md-menu': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        anchor?: string
        positioning?: string
        quick?: boolean
      }, HTMLElement>
      'md-menu-item': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
        'data-idx'?: number
        selected?: boolean
      }, HTMLElement>
    }
  }
}

interface MonthMenuProps {
  year: number
  month: number
  onMonthJump: (year: number, month: number) => void
}

export default function MonthMenu({ year, month, onMonthJump }: MonthMenuProps) {
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const theme = useTheme()
  const { i18n } = useTranslation()
  const monthNames = useMemo(() => getMonthNames(i18n.resolvedLanguage ?? 'en'), [i18n.resolvedLanguage])
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
    const menu = menuRef.current as (HTMLElement & { open?: boolean }) | null
    if (!menu) return
    menu.open = open
  }, [open])

  const handleSelect = useCallback((e: React.SyntheticEvent<HTMLElement>) => {
    const idx = Number((e.currentTarget as HTMLElement).dataset.idx)
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
        {monthNames[month - 1]} {year}
      </button>
      <md-menu
        ref={menuRef}
        anchor={uid}
        positioning="absolute"
        quick
      >
        {monthNames.map((name, i) => (
          <md-menu-item
            key={name}
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
