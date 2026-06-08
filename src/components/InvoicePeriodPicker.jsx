import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Popover from '@mui/material/Popover'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import CalendarTodayIcon from '@mui/icons-material/CalendarToday'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import PropTypes from 'prop-types'
import { invoiceShape, periodShape } from '../propTypes/shared.js'
import { periodLabel } from '../utils/invoicePeriod.js'

const MODES = ['month', 'quarter', 'fiscal_year', 'all_time']
const MODE_LABELS = { month: 'Month', quarter: 'Quarter', fiscal_year: 'Fiscal Year', all_time: 'All Time' }
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ─── internal grid cell ────────────────────────────────────────────────────

function GridCell({ label, hasData, isSelected, onClick }) {
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
        color: isSelected ? 'primary.contrastText' : hasData ? 'text.primary' : 'text.disabled',
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

GridCell.propTypes = {
  label: PropTypes.string.isRequired,
  hasData: PropTypes.bool.isRequired,
  isSelected: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
}

// ─── main component ────────────────────────────────────────────────────────

export default function InvoicePeriodPicker({ invoices, value, onChange }) {
  const [anchor, setAnchor] = useState(null)
  const [pickerMode, setPickerMode] = useState(
    value.mode === 'custom' ? 'fiscal_year' : value.mode,
  )
  const [viewYear, setViewYear] = useState(value.year ?? new Date().getFullYear())
  const [viewDecade, setViewDecade] = useState(
    Math.floor((value.year ?? new Date().getFullYear()) / 10) * 10,
  )
  const [customFrom, setCustomFrom] = useState(value.mode === 'custom' ? value.from : '')
  const [customTo, setCustomTo] = useState(value.mode === 'custom' ? value.to : '')

  // Pre-compute which years / months / quarters have invoice data.
  const { yearsWithData, monthsByYear, quartersByYear } = useMemo(() => {
    const years = new Set()
    const monthMap = new Map()
    const quarterMap = new Map()
    for (const inv of invoices) {
      if (!inv.issue_date) continue
      const d = new Date(inv.issue_date)
      const y = d.getFullYear()
      const m = d.getMonth()
      const q = Math.floor(m / 3) + 1
      years.add(y)
      if (!monthMap.has(y)) monthMap.set(y, new Set())
      monthMap.get(y).add(m)
      if (!quarterMap.has(y)) quarterMap.set(y, new Set())
      quarterMap.get(y).add(q)
    }
    return { yearsWithData: years, monthsByYear: monthMap, quartersByYear: quarterMap }
  }, [invoices])

  // ── handlers ──────────────────────────────────────────────────────────────

  function handleOpen(e) {
    const year = value.year ?? new Date().getFullYear()
    setPickerMode(value.mode === 'custom' ? 'fiscal_year' : value.mode)
    setViewYear(year)
    setViewDecade(Math.floor(year / 10) * 10)
    setCustomFrom(value.mode === 'custom' ? value.from : '')
    setCustomTo(value.mode === 'custom' ? value.to : '')
    setAnchor(e.currentTarget)
  }

  function handleClose() {
    setAnchor(null)
  }

  function handleSelect(newValue) {
    onChange(newValue)
    setAnchor(null)
  }

  function handleModeChange(_, newMode) {
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

  // ── derived display values ─────────────────────────────────────────────────

  const decadeYears = Array.from({ length: 10 }, (_, i) => viewDecade + i)

  const navigatorLabel =
    pickerMode === 'fiscal_year'
      ? `${viewDecade} – ${viewDecade + 9}`
      : String(viewYear)

  const showGrid = pickerMode !== 'all_time'
  const open = Boolean(anchor)

  // ── render ─────────────────────────────────────────────────────────────────

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
          {/* Mode tabs */}
          <ToggleButtonGroup
            value={pickerMode}
            exclusive
            onChange={handleModeChange}
            size="small"
            fullWidth
            sx={{ mb: 2 }}
          >
            {MODES.map((m) => (
              <ToggleButton
                key={m}
                value={m}
                sx={{ flex: 1, fontSize: '0.72rem', py: 0.5, px: 0.25, lineHeight: 1.4 }}
              >
                {MODE_LABELS[m]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          {/* Year / decade navigator + selection grid */}
          {showGrid && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <IconButton size="small" onClick={handleNavPrev} aria-label="previous">
                  <ChevronLeftIcon fontSize="small" />
                </IconButton>
                <Typography variant="body2" fontWeight={600} sx={{ flex: 1, textAlign: 'center' }}>
                  {navigatorLabel}
                </Typography>
                <IconButton size="small" onClick={handleNavNext} aria-label="next">
                  <ChevronRightIcon fontSize="small" />
                </IconButton>
              </Box>

              {pickerMode === 'fiscal_year' && (
                <Box
                  role="listbox"
                  aria-label="Select fiscal year"
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
                  aria-label="Select month"
                  sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5, mb: 1.5 }}
                >
                  {MONTH_LABELS.map((label, idx) => (
                    <GridCell
                      key={label}
                      label={label}
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
                  aria-label="Select quarter"
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

          {/* Custom range */}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Custom Range
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <TextField
              size="small"
              label="From"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              sx={{ flex: 1 }}
              slotProps={{
                htmlInput: { type: 'date', max: customTo || undefined },
                inputLabel: { shrink: true },
              }}
            />
            <Typography variant="body2" color="text.secondary">→</Typography>
            <TextField
              size="small"
              label="To"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              sx={{ flex: 1 }}
              slotProps={{
                htmlInput: { type: 'date', min: customFrom || undefined },
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
            Apply
          </Button>
        </Box>
      </Popover>
    </>
  )
}

InvoicePeriodPicker.propTypes = {
  invoices: PropTypes.arrayOf(invoiceShape).isRequired,
  value: periodShape.isRequired,
  onChange: PropTypes.func.isRequired,
}
