import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Popover from '@mui/material/Popover'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DateEntryField from '../DateEntryField.tsx'
import { periodLabel } from '../../utils/invoicePeriod.ts'
import type { Period } from '../../types/entities.ts'

const MODES = ['month', 'quarter', 'fiscal_year', 'all_time'] as const
const MONTH_KEYS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const

interface GridCellProps {
  label: string
  hasData: boolean
  isSelected: boolean
  onClick: () => void
}

function GridCell({ label, hasData, isSelected, onClick }: Readonly<GridCellProps>) {
  let color = 'text.disabled'
  if (isSelected) color = 'primary.contrastText'
  else if (hasData) color = 'text.primary'
  return (
    <Box
      role="option"
      aria-selected={isSelected}
      aria-disabled={!hasData}
      onClick={hasData ? onClick : undefined}
      sx={{
        py: 1,
        borderRadius: 2,
        textAlign: 'center',
        cursor: hasData ? 'pointer' : 'default',
        bgcolor: isSelected ? 'primary.main' : 'transparent',
        color,
        fontWeight: hasData ? 600 : 400,
        fontSize: '0.875rem',
        userSelect: 'none',
        transition: 'background-color 0.12s',
        ...(hasData && !isSelected && {
          '&:hover': { bgcolor: 'action.hover' },
        }),
      }}
    >
      {label}
    </Box>
  )
}

function buildAvailability(availableDates: string[]) {
  const yearsWithData = new Set<number>()
  const monthsByYear = new Map<number, Set<number>>()
  const quartersByYear = new Map<number, Set<number>>()

  for (const value of availableDates) {
    if (!value) continue
    const d = new Date(`${String(value).slice(0, 10)}T12:00:00`)
    if (Number.isNaN(d.getTime())) continue

    const y = d.getFullYear()
    const m = d.getMonth()
    const q = Math.floor(m / 3) + 1
    yearsWithData.add(y)
    if (!monthsByYear.has(y)) monthsByYear.set(y, new Set())
    monthsByYear.get(y)!.add(m)
    if (!quartersByYear.has(y)) quartersByYear.set(y, new Set())
    quartersByYear.get(y)!.add(q)
  }

  return { yearsWithData, monthsByYear, quartersByYear }
}

interface PeriodPickerProps {
  availableDates: string[]
  value: Period
  onChange: (value: Period) => void
}

export default function PeriodPicker({ availableDates, value, onChange }: Readonly<PeriodPickerProps>) {
  const { t } = useTranslation('common')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [pickerMode, setPickerMode] = useState<string>(
    value.mode === 'custom' ? 'fiscal_year' : value.mode,
  )
  const [viewYear, setViewYear] = useState(value.year ?? new Date().getFullYear())
  const [viewDecade, setViewDecade] = useState(
    Math.floor((value.year ?? new Date().getFullYear()) / 10) * 10,
  )
  const [customFrom, setCustomFrom] = useState(value.mode === 'custom' ? (value.from ?? '') : '')
  const [customTo, setCustomTo] = useState(value.mode === 'custom' ? (value.to ?? '') : '')

  const { yearsWithData, monthsByYear, quartersByYear } = useMemo(
    () => buildAvailability(availableDates),
    [availableDates],
  )

  function handleOpen(e: React.MouseEvent<HTMLElement>) {
    const year = value.year ?? new Date().getFullYear()
    setPickerMode(value.mode === 'custom' ? 'fiscal_year' : value.mode)
    setViewYear(year)
    setViewDecade(Math.floor(year / 10) * 10)
    setCustomFrom(value.mode === 'custom' ? (value.from ?? '') : '')
    setCustomTo(value.mode === 'custom' ? (value.to ?? '') : '')
    setAnchor(e.currentTarget)
  }

  function handleClose() {
    setAnchor(null)
  }

  function handleSelect(newValue: Period) {
    onChange(newValue)
    setAnchor(null)
  }

  function handleModeChange(_: unknown, newMode: string | null) {
    if (!newMode) return
    setPickerMode(newMode)
    if (newMode === 'all_time') handleSelect({ mode: 'all_time' })
  }

  function handleNavPrev() {
    if (pickerMode === 'fiscal_year') setViewDecade((d) => d - 10)
    else setViewYear((y) => y - 1)
  }

  function handleNavNext() {
    if (pickerMode === 'fiscal_year') setViewDecade((d) => d + 10)
    else setViewYear((y) => y + 1)
  }

  function handleCustomApply() {
    if (!customFrom || !customTo) return
    handleSelect({ mode: 'custom', from: customFrom, to: customTo })
  }

  const decadeYears = Array.from({ length: 10 }, (_, i) => viewDecade + i)
  const navigatorLabel =
    pickerMode === 'fiscal_year'
      ? `${viewDecade} - ${viewDecade + 9}`
      : String(viewYear)
  const showGrid = pickerMode !== 'all_time'
  const open = Boolean(anchor)

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<CalendarTodayIcon />}
        onClick={handleOpen}
        aria-haspopup="true"
        aria-expanded={open}
      >
        {periodLabel(value)}
      </Button>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 312 } } }}
      >
        <Box sx={{ p: 2 }}>
          <ToggleButtonGroup
            value={pickerMode}
            exclusive
            onChange={handleModeChange}
            size="small"
            fullWidth
            sx={{ mb: 2 }}
          >
            {MODES.map((mode) => (
              <ToggleButton
                key={mode}
                value={mode}
                sx={{ flex: 1, fontSize: '0.72rem', py: 0.5, px: 0.25, lineHeight: 1.4 }}
              >
                {t($ => $.periodPicker.modes[mode])}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          {showGrid && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <IconButton size="small" onClick={handleNavPrev} aria-label={t($ => $.periodPicker.previous)}>
                  <ChevronLeftIcon fontSize="small" />
                </IconButton>
                <Typography variant="body2" sx={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>
                  {navigatorLabel}
                </Typography>
                <IconButton size="small" onClick={handleNavNext} aria-label={t($ => $.periodPicker.next)}>
                  <ChevronRightIcon fontSize="small" />
                </IconButton>
              </Box>

              {pickerMode === 'fiscal_year' && (
                <Box
                  role="listbox"
                  aria-label={t($ => $.periodPicker.selectFiscalYear)}
                  sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5, mb: 1.5 }}
                >
                  {decadeYears.map((year) => (
                    <GridCell
                      key={year}
                      label={String(year)}
                      hasData={yearsWithData.has(year)}
                      isSelected={value.mode === 'fiscal_year' && value.year === year}
                      onClick={() => handleSelect({ mode: 'fiscal_year', year })}
                    />
                  ))}
                </Box>
              )}

              {pickerMode === 'month' && (
                <Box
                  role="listbox"
                  aria-label={t($ => $.periodPicker.selectMonth)}
                  sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5, mb: 1.5 }}
                >
                  {MONTH_KEYS.map((monthKey, idx) => (
                    <GridCell
                      key={monthKey}
                      label={t($ => $.periodPicker.months[monthKey])}
                      hasData={monthsByYear.get(viewYear)?.has(idx) ?? false}
                      isSelected={
                        value.mode === 'month' && value.year === viewYear && value.month === idx
                      }
                      onClick={() => handleSelect({ mode: 'month', year: viewYear, month: idx })}
                    />
                  ))}
                </Box>
              )}

              {pickerMode === 'quarter' && (
                <Box
                  role="listbox"
                  aria-label={t($ => $.periodPicker.selectQuarter)}
                  sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0.5, mb: 1.5 }}
                >
                  {[1, 2, 3, 4].map((q) => (
                    <GridCell
                      key={q}
                      label={`Q${q}`}
                      hasData={quartersByYear.get(viewYear)?.has(q) ?? false}
                      isSelected={
                        value.mode === 'quarter' && value.year === viewYear && value.quarter === q
                      }
                      onClick={() => handleSelect({ mode: 'quarter', year: viewYear, quarter: q })}
                    />
                  ))}
                </Box>
              )}
            </>
          )}

          <Divider sx={{ mb: 1.5 }} />

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t($ => $.periodPicker.customRange)}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <DateEntryField
              size="small"
              label={t($ => $.periodPicker.from)}
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              openPickerLabel={t($ => $.periodPicker.openFromPicker)}
              sx={{ flex: 1 }}
              slotProps={{
                htmlInput: { max: customTo || undefined },
                inputLabel: { shrink: true },
              }}
            />
            <Typography variant="body2" color="text.secondary">{t($ => $.periodPicker.rangeSeparator)}</Typography>
            <DateEntryField
              size="small"
              label={t($ => $.periodPicker.to)}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              openPickerLabel={t($ => $.periodPicker.openToPicker)}
              sx={{ flex: 1 }}
              slotProps={{
                htmlInput: { min: customFrom || undefined },
                inputLabel: { shrink: true },
              }}
            />
          </Box>
          <Button
            variant="contained"
            size="small"
            fullWidth
            disabled={!customFrom || !customTo}
            onClick={handleCustomApply}
          >
            {t($ => $.periodPicker.apply)}
          </Button>
        </Box>
      </Popover>
    </>
  )
}
