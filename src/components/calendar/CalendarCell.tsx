import React from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTheme, alpha } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'
import {
  GIG_STATUS_COLORS,
  REHEARSAL_STATUS_COLORS,
  BAND_EVENT_COLOR,
  getMemberColor,
} from '../../utils/availabilityUtils.ts'
import { venueHeadline } from '../../utils/venueDisplay.ts'
import { getEventTextColor } from './calendarColors.ts'
import type { CalendarCell as CalendarCellData, Member, Slot, Gig, Rehearsal, BandEvent } from '../../types/entities.ts'

const BAR_SX = {
  minHeight: 20,
  width: '100%',
  px: 0.5,
  py: 0.25,
  borderRadius: 0.5,
  fontSize: '0.7rem',
  lineHeight: 1.2,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

interface DayNumberProps {
  date: Date
  mobile?: boolean
  isToday?: boolean
  isSelected?: boolean
  inMonth?: boolean
  theme: Theme
}

function DayNumber({ date, mobile, isToday, isSelected, inMonth, theme }: DayNumberProps) {
  if (mobile) {
    let bgcolor = 'transparent'
    if (isToday) bgcolor = 'primary.main'
    else if (isSelected) bgcolor = alpha(theme.palette.primary.main, 0.6)
    let color = inMonth ? 'text.primary' : 'text.disabled'
    if (isToday || isSelected) color = 'primary.contrastText'
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', bgcolor, color }}>
        <Typography variant="caption" sx={{ lineHeight: 1, color: 'inherit' }}>{date.getDate()}</Typography>
      </Box>
    )
  }
  if (isToday) {
    return (
      <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }}>
        <Typography variant="caption" sx={{ lineHeight: 1, color: 'primary.contrastText', fontSize: '0.7rem', fontWeight: 700 }}>
          {date.getDate()}
        </Typography>
      </Box>
    )
  }
  return (
    <Typography variant="caption" sx={{ display: 'block', color: inMonth ? 'text.primary' : 'text.disabled' }}>
      {date.getDate()}
    </Typography>
  )
}

interface DotProps {
  bgcolor?: string
  opacity?: number
  dataAttr?: Record<string, string | number>
}

function Dot({ bgcolor, opacity, dataAttr }: DotProps) {
  return <Box {...dataAttr} sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor, opacity }} />
}

interface MobileDotsProps {
  cell: CalendarCellData
  members: Member[]
}

function MobileDots({ cell, members }: MobileDotsProps) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, justifyContent: 'center', flexWrap: 'wrap', gap: 0.5, rowGap: 0.25 }}>
      {(cell.cellGigs ?? []).map((gig) => (
        <Dot key={`g-${gig.id}`} dataAttr={{ 'data-gig-id': String(gig.id) }} bgcolor={GIG_STATUS_COLORS[gig.status ?? ''] || 'grey.500'} />
      ))}
      {(cell.cellRehearsals ?? []).map((reh) => (
        <Dot key={`r-${reh.id}`} dataAttr={{ 'data-rehearsal-id': String(reh.id) }} bgcolor={REHEARSAL_STATUS_COLORS[reh.status ?? ''] || 'grey.400'} opacity={reh.status === 'option' ? 0.7 : 1} />
      ))}
      {(cell.cellBandEvents ?? []).map((ev) => (
        <Dot key={`be-${ev.id}`} dataAttr={{ 'data-band-event-id': String(ev.id) }} bgcolor={BAND_EVENT_COLOR} />
      ))}
      {(cell.cellSlots ?? []).map((slot) => (
        <Dot key={`s-${slot.id}`} dataAttr={{ 'data-slot-id': String(slot.id) }} bgcolor={getMemberColor(slot, members)} />
      ))}
    </Stack>
  )
}

interface GigBarProps {
  gig: Gig
  theme: Theme
  onGigClick?: (gig: Gig) => void
}

function GigBar({ gig, theme, onGigClick }: GigBarProps) {
  const backgroundColor = GIG_STATUS_COLORS[gig.status ?? ''] || 'grey.500'
  return (
    <Tooltip title={[gig.event_description, venueHeadline(gig.venue ?? gig.festival), gig.status].filter(Boolean).join(' — ')}>
      <Box
        data-gig-id={gig.id}
        onClick={(e) => { e.stopPropagation(); onGigClick?.(gig) }}
        sx={{ ...BAR_SX, bgcolor: backgroundColor, color: getEventTextColor(theme, backgroundColor), cursor: onGigClick ? 'pointer' : 'default' }}
      >
        {gig.event_description || venueHeadline(gig.venue ?? gig.festival) || 'Gig'}
      </Box>
    </Tooltip>
  )
}

interface RehearsalBarProps {
  reh: Rehearsal
  theme: Theme
  onRehearsalClick?: (reh: Rehearsal) => void
}

function RehearsalBar({ reh, theme, onRehearsalClick }: RehearsalBarProps) {
  const yes = reh.participants?.filter((p) => p.vote === 'yes').length ?? 0
  const total = reh.participants?.length ?? 0
  const isOption = reh.status === 'option'
  const backgroundColor = REHEARSAL_STATUS_COLORS[reh.status ?? ''] || 'grey.400'
  return (
    <Tooltip title={[`Rehearsal — ${reh.status}`, reh.location, `${yes}/${total} yes`].filter(Boolean).join(' — ')}>
      <Box
        data-rehearsal-id={reh.id}
        onClick={(e) => { e.stopPropagation(); onRehearsalClick?.(reh) }}
        sx={{
          ...BAR_SX,
          bgcolor: isOption ? 'transparent' : backgroundColor,
          border: isOption ? '1px dashed' : 'none',
          borderColor: isOption ? 'grey.500' : 'transparent',
          color: isOption ? 'text.primary' : getEventTextColor(theme, backgroundColor),
          cursor: onRehearsalClick ? 'pointer' : 'default',
        }}
      >
        {`Reh ${yes}/${total}`}
      </Box>
    </Tooltip>
  )
}

interface BandEventBarProps {
  ev: BandEvent
  theme: Theme
  onBandEventClick?: (ev: BandEvent) => void
}

function BandEventBar({ ev, theme, onBandEventClick }: BandEventBarProps) {
  return (
    <Tooltip title={[ev.title, ev.location].filter(Boolean).join(' — ')}>
      <Box
        data-band-event-id={ev.id}
        onClick={(e) => { e.stopPropagation(); onBandEventClick?.(ev) }}
        sx={{ ...BAR_SX, bgcolor: BAND_EVENT_COLOR, color: getEventTextColor(theme, BAND_EVENT_COLOR), cursor: onBandEventClick ? 'pointer' : 'default' }}
      >
        {ev.title}
      </Box>
    </Tooltip>
  )
}

interface SlotBarProps {
  slot: Slot
  members: Member[]
  theme: Theme
  onSlotClick: (slot: Slot) => void
}

function SlotBar({ slot, members, theme, onSlotClick }: SlotBarProps) {
  const color = getMemberColor(slot, members)
  const isUnavailable = slot.status === 'unavailable'
  const memberName = slot.band_member_id === null
    ? 'Band'
    : members.find((m) => m.id === slot.band_member_id)?.name || ''
  return (
    <Tooltip title={[slot.band_member_id === null ? 'Band-wide' : memberName, slot.status, slot.reason].filter(Boolean).join(' — ')}>
      <Box
        data-slot-id={slot.id}
        onClick={(e) => { e.stopPropagation(); onSlotClick(slot) }}
        sx={{
          ...BAR_SX,
          bgcolor: color,
          color: getEventTextColor(theme, color),
          cursor: 'pointer',
          backgroundImage: isUnavailable
            ? 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.35) 3px, rgba(0,0,0,0.35) 6px)'
            : 'none',
        }}
      >
        {memberName}
      </Box>
    </Tooltip>
  )
}

interface DesktopEventsProps {
  cell: CalendarCellData
  members: Member[]
  theme: Theme
  onGigClick?: (gig: Gig) => void
  onRehearsalClick?: (reh: Rehearsal) => void
  onBandEventClick?: (ev: BandEvent) => void
  onSlotClick: (slot: Slot) => void
}

function DesktopEvents({ cell, members, theme, onGigClick, onRehearsalClick, onBandEventClick, onSlotClick }: DesktopEventsProps) {
  return (
    <>
      <Stack spacing={0.375} sx={{ mt: 0.25 }}>
        {(cell.cellGigs ?? []).map((gig) => (
          <GigBar key={gig.id} gig={gig} theme={theme} onGigClick={onGigClick} />
        ))}
        {(cell.cellRehearsals ?? []).map((reh) => (
          <RehearsalBar key={`reh-${reh.id}`} reh={reh} theme={theme} onRehearsalClick={onRehearsalClick} />
        ))}
        {(cell.cellBandEvents ?? []).map((ev) => (
          <BandEventBar key={`be-${ev.id}`} ev={ev} theme={theme} onBandEventClick={onBandEventClick} />
        ))}
      </Stack>
      <Stack spacing={0.375} sx={{ mt: 0.375 }}>
        {(cell.cellSlots ?? []).map((slot) => (
          <SlotBar key={slot.id} slot={slot} members={members} theme={theme} onSlotClick={onSlotClick} />
        ))}
      </Stack>
    </>
  )
}

interface CalendarCellProps {
  cell: CalendarCellData
  members: Member[]
  mobile?: boolean
  onDayClick: (iso: string, shift: boolean, target: EventTarget) => void
  onSlotClick: (slot: Slot) => void
  onGigClick?: (gig: Gig) => void
  onRehearsalClick?: (reh: Rehearsal) => void
  onBandEventClick?: (ev: BandEvent) => void
}

export default function CalendarCell({
  cell, members, mobile, onDayClick, onSlotClick, onGigClick, onRehearsalClick, onBandEventClick,
}: CalendarCellProps) {
  const theme = useTheme()
  const { iso, date, inMonth, isRowStart, week, isSelected, isToday, bgcolor } = cell

  return (
    <React.Fragment>
      {isRowStart && (
        <Typography
          key={`wk-${iso}`}
          variant="caption"
          align="center"
          color="text.disabled"
          sx={{
            display: 'flex',
            alignItems: mobile ? 'center' : 'flex-start',
            justifyContent: 'center',
            pt: mobile ? 0 : 0.5,
            fontSize: '0.65rem',
          }}
        >
          {week}
        </Typography>
      )}
      <Box
        data-date={iso}
        onClick={(e) => onDayClick(iso, e.shiftKey, e.currentTarget)}
        sx={{
          aspectRatio: '1 / 1',
          borderRadius: 0,
          bgcolor,
          border: mobile ? 'none' : '1px solid',
          borderColor: 'divider',
          mr: mobile ? 0 : '-1px',
          mb: mobile ? 0 : '-1px',
          cursor: 'pointer',
          p: mobile ? 0 : 0.5,
          minWidth: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: mobile ? 'center' : 'stretch',
          justifyContent: 'flex-start',
          pt: 0.5,
          '&:hover': { bgcolor: mobile ? 'transparent' : 'action.hover' },
        }}
      >
        <DayNumber date={date!} mobile={mobile} isToday={isToday} isSelected={isSelected} inMonth={inMonth} theme={theme} />
        {mobile ? (
          <MobileDots cell={cell} members={members} />
        ) : (
          <DesktopEvents
            cell={cell}
            members={members}
            theme={theme}
            onGigClick={onGigClick}
            onRehearsalClick={onRehearsalClick}
            onBandEventClick={onBandEventClick}
            onSlotClick={onSlotClick}
          />
        )}
      </Box>
    </React.Fragment>
  )
}
