import { useMemo } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import { normalizeIsoDate, toIsoDate } from '../utils/availabilityUtils.js'
import {
  DAY_HEADERS,
  buildCalendarCells,
  buildCalendarCellViewModel,
  indexByDate,
  indexByDateRange,
} from './calendar/calendarGrid.js'
import MonthMenu from './calendar/MonthMenu.jsx'
import CalendarCell from './calendar/CalendarCell.jsx'
import {
  memberShape,
  slotShape,
  gigShape,
  rehearsalShape,
  bandEventShape,
} from '../propTypes/shared.js'

export default function AvailabilityCalendar({
  year,
  month,
  slots,
  gigs = [],
  rehearsals = [],
  bandEvents = [],
  members,
  selectionStart,
  selectedDay,
  mobile = false,
  onDayClick,
  onSlotClick,
  onGigClick,
  onRehearsalClick,
  onBandEventClick,
  onPrev,
  onNext,
  onMonthJump,
  onExport,
}) {
  const today = toIsoDate(new Date())
  const cells = useMemo(() => buildCalendarCells(year, month), [year, month])

  const gigsByDate = useMemo(
    () => indexByDate(gigs, (g) => normalizeIsoDate(g.event_date)),
    [gigs],
  )
  const rehearsalsByDate = useMemo(
    () => indexByDate(rehearsals, (r) => normalizeIsoDate(r.proposed_date)),
    [rehearsals],
  )
  const bandEventsByDate = useMemo(
    () => indexByDateRange(
      bandEvents,
      (ev) => normalizeIsoDate(ev.start_date),
      (ev) => normalizeIsoDate(ev.end_date) || normalizeIsoDate(ev.start_date),
      cells,
    ),
    [bandEvents, cells],
  )
  const slotsByDate = useMemo(
    () => indexByDateRange(slots, (s) => s.start_date, (s) => s.end_date, cells),
    [slots, cells],
  )

  const cellViewModels = useMemo(() => {
    const cellCtx = { slotsByDate, gigsByDate, rehearsalsByDate, bandEventsByDate, selectionStart, selectedDay, mobile, today }
    return cells.map((cell, idx) => buildCalendarCellViewModel(cell, idx, cellCtx))
  }, [cells, slotsByDate, gigsByDate, rehearsalsByDate, bandEventsByDate, selectionStart, selectedDay, mobile, today])

  return (
    <Box sx={{ maxWidth: 1024, mx: 'auto' }}>
      <Stack direction="row" sx={{ mb: 1, width: '100%', alignItems: 'center' }}>
        <IconButton size="small" onClick={onPrev} aria-label="previous month">
          <ChevronLeftIcon />
        </IconButton>
          <IconButton size="small" onClick={onNext} aria-label="next month">
          <ChevronRightIcon />
        </IconButton>
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <MonthMenu year={year} month={month} onMonthJump={onMonthJump} />
        </Box>
      
        {onExport && (
          <Tooltip title="Export month to calendar (.ics)">
            <IconButton size="small" onClick={onExport} aria-label="export to calendar">
              <FileDownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      {mobile ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: '28px repeat(7, 1fr)', gap: 0 }}>
          <Typography variant="caption" align="center" color="text.secondary" sx={{ py: 0.5 }}>
            Wk
          </Typography>
          {DAY_HEADERS.map((d) => (
            <Typography key={d} variant="caption" align="center" color="text.secondary" sx={{ py: 0.5 }}>
              {d}
            </Typography>
          ))}

          {cellViewModels.map((cell) => (
            <CalendarCell
              key={cell.iso}
              cell={cell}
              members={members}
              mobile={mobile}
              onDayClick={onDayClick}
              onSlotClick={onSlotClick}
              onGigClick={onGigClick}
              onRehearsalClick={onRehearsalClick}
              onBandEventClick={onBandEventClick}
            />
          ))}
        </Box>
      ) : (
        <Card variant="outlined" sx={{ borderRadius: '12px' }}>
          <Box sx={{ pt: 0.5, pr: '22px', pb: 2, pl: 0, display: 'grid', gridTemplateColumns: '22px repeat(7, 1fr)', gap: 0 }}>
            <Typography variant="caption" align="center" color="text.secondary" sx={{ py: 0.5 }}>
              Wk
            </Typography>
            {DAY_HEADERS.map((d) => (
              <Typography key={d} variant="caption" align="center" color="text.secondary" sx={{ py: 0.5 }}>
                {d}
              </Typography>
            ))}

            {cellViewModels.map((cell) => (
              <CalendarCell
                key={cell.iso}
                cell={cell}
                members={members}
                mobile={mobile}
                onDayClick={onDayClick}
                onSlotClick={onSlotClick}
                onGigClick={onGigClick}
                onRehearsalClick={onRehearsalClick}
                onBandEventClick={onBandEventClick}
              />
            ))}
          </Box>
        </Card>
      )}
    </Box>
  )
}

AvailabilityCalendar.propTypes = {
  year: PropTypes.number.isRequired,
  month: PropTypes.number.isRequired,
  slots: PropTypes.arrayOf(slotShape).isRequired,
  gigs: PropTypes.arrayOf(gigShape),
  rehearsals: PropTypes.arrayOf(rehearsalShape),
  bandEvents: PropTypes.arrayOf(bandEventShape),
  members: PropTypes.arrayOf(memberShape).isRequired,
  selectionStart: PropTypes.string,
  selectedDay: PropTypes.string,
  mobile: PropTypes.bool,
  onDayClick: PropTypes.func.isRequired,
  onSlotClick: PropTypes.func.isRequired,
  onGigClick: PropTypes.func,
  onRehearsalClick: PropTypes.func,
  onBandEventClick: PropTypes.func,
  onPrev: PropTypes.func.isRequired,
  onNext: PropTypes.func.isRequired,
  onMonthJump: PropTypes.func.isRequired,
  onExport: PropTypes.func,
}
