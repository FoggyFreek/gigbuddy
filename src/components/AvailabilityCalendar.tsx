import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import CloudSyncIcon from '@mui/icons-material/CloudSync'
import { normalizeIsoDate, toIsoDate } from '../utils/availabilityUtils.ts'
import {
  getDayHeaders,
  buildCalendarCells,
  buildCalendarCellViewModel,
  indexByDate,
  indexByDateRange,
} from './calendar/calendarGrid.ts'
import MonthMenu from './calendar/MonthMenu.tsx'
import CalendarCell from './calendar/CalendarCell.tsx'
import type { Gig, Member, BandEvent, Slot, Rehearsal } from '../types/entities.ts'

interface AvailabilityCalendarProps {
  year: number
  month: number
  slots: Slot[]
  gigs?: Gig[]
  rehearsals?: Rehearsal[]
  bandEvents?: BandEvent[]
  members: Member[]
  selectionStart?: string
  selectedDay?: string
  mobile?: boolean
  onDayClick: (dateStr: string, shiftKey: boolean, targetEl: EventTarget | null) => void
  onSlotClick: (slot: Slot) => void
  onGigClick?: (gig: Gig) => void
  onRehearsalClick?: (reh: Rehearsal) => void
  onBandEventClick?: (ev: BandEvent) => void
  onPrev: () => void
  onNext: () => void
  onMonthJump: (year: number, month: number) => void
  onExport?: () => void
  onSubscribe?: () => void
}

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
  onSubscribe,
}: AvailabilityCalendarProps) {
  const { t, i18n } = useTranslation('availability')
  const dayHeaders = useMemo(() => getDayHeaders(i18n.resolvedLanguage ?? 'en'), [i18n.resolvedLanguage])
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridHeight, setGridHeight] = useState<number>()

  // Desktop: size the grid to the viewport so the week rows (and their cells)
  // shrink to fit instead of forcing square cells that overflow the screen.
  useLayoutEffect(() => {
    if (mobile) return
    const recalc = () => {
      const el = gridRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      const avail = window.innerHeight - top - 24 // breathing room at the bottom
      setGridHeight(Math.max(avail, 360))
    }
    recalc()
    window.addEventListener('resize', recalc)
    return () => {
      window.removeEventListener('resize', recalc)
      setGridHeight(undefined)
    }
  }, [mobile])

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current
    touchStartRef.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // Require a clearly horizontal gesture so vertical scrolling never flips months.
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0) onNext()
    else onPrev()
  }

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
    const cellCtx = { slotsByDate, gigsByDate, rehearsalsByDate, bandEventsByDate, selectionStart: selectionStart ?? null, selectedDay: selectedDay ?? null, mobile, today }
    return cells.map((cell, idx) => buildCalendarCellViewModel(cell, idx, cellCtx))
  }, [cells, slotsByDate, gigsByDate, rehearsalsByDate, bandEventsByDate, selectionStart, selectedDay, mobile, today])

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
      <Stack direction="row" sx={{ mb: 1, width: '100%', alignItems: 'center' }}>
        <IconButton size="small" onClick={onPrev} aria-label={t($ => $.nav.prevMonth)}>
          <ChevronLeftIcon />
        </IconButton>
          <IconButton size="small" onClick={onNext} aria-label={t($ => $.nav.nextMonth)}>
          <ChevronRightIcon />
        </IconButton>
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <MonthMenu year={year} month={month} onMonthJump={onMonthJump} />
        </Box>

        {onSubscribe && (
          <Tooltip title={t($ => $.subscribe.tooltip)}>
            <IconButton size="small" onClick={onSubscribe} aria-label={t($ => $.subscribe.aria)}>
              <CloudSyncIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onExport && (
          <Tooltip title={t($ => $.export.tooltip)}>
            <IconButton size="small" onClick={onExport} aria-label={t($ => $.export.aria)}>
              <FileDownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      {mobile ? (
        <Box
          data-swipe-area="calendar"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          sx={{ display: 'grid', gridTemplateColumns: '28px repeat(7, 1fr)', gap: 0 }}
        >
          <Typography variant="caption" align="center" color="text.secondary" sx={{ py: 0.5 }}>
            {t($ => $.weekAbbrev)}
          </Typography>
          {dayHeaders.map((d) => (
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
          <Box
            ref={gridRef}
            sx={{
              pt: 0.5,
              pr: '22px',
              pb: 2,
              pl: 0,
              display: 'grid',
              gridTemplateColumns: '22px repeat(7, 1fr)',
              gridTemplateRows: 'auto',
              gridAutoRows: 'minmax(56px, 1fr)',
              gap: 0,
              height: gridHeight,
            }}
          >
            <Typography variant="caption" align="center" color="text.secondary" sx={{ py: 0.5 }}>
              {t($ => $.weekAbbrev)}
            </Typography>
            {dayHeaders.map((d) => (
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
