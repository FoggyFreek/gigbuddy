import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTheme, alpha } from '@mui/material/styles'
import {
  GIG_STATUS_COLORS,
  REHEARSAL_STATUS_COLORS,
  BAND_EVENT_COLOR,
  getMemberColor,
} from '../../utils/availabilityUtils.js'
import { venueHeadline } from '../../utils/venueDisplay.js'
import { getEventTextColor } from './calendarColors.js'
import {
  calendarCellShape,
  memberShape,
  slotShape,
  gigShape,
  rehearsalShape,
  bandEventShape,
} from '../../propTypes/shared.js'

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

function DayNumber({ date, mobile, isToday, isSelected, inMonth, theme }) {
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

DayNumber.propTypes = {
  date: PropTypes.instanceOf(Date).isRequired,
  mobile: PropTypes.bool,
  isToday: PropTypes.bool,
  isSelected: PropTypes.bool,
  inMonth: PropTypes.bool,
  theme: PropTypes.object.isRequired,
}

function Dot({ bgcolor, opacity, dataAttr }) {
  return <Box {...dataAttr} sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor, opacity }} />
}

Dot.propTypes = {
  bgcolor: PropTypes.string,
  opacity: PropTypes.number,
  dataAttr: PropTypes.object,
}

function MobileDots({ cell, members }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, justifyContent: 'center', flexWrap: 'wrap', gap: 0.5, rowGap: 0.25 }}>
      {cell.cellGigs.map((gig) => (
        <Dot key={`g-${gig.id}`} dataAttr={{ 'data-gig-id': gig.id }} bgcolor={GIG_STATUS_COLORS[gig.status] || 'grey.500'} />
      ))}
      {cell.cellRehearsals.map((reh) => (
        <Dot key={`r-${reh.id}`} dataAttr={{ 'data-rehearsal-id': reh.id }} bgcolor={REHEARSAL_STATUS_COLORS[reh.status] || 'grey.400'} opacity={reh.status === 'option' ? 0.7 : 1} />
      ))}
      {cell.cellBandEvents.map((ev) => (
        <Dot key={`be-${ev.id}`} dataAttr={{ 'data-band-event-id': ev.id }} bgcolor={BAND_EVENT_COLOR} />
      ))}
      {cell.cellSlots.map((slot) => (
        <Dot key={`s-${slot.id}`} dataAttr={{ 'data-slot-id': slot.id }} bgcolor={getMemberColor(slot, members)} />
      ))}
    </Stack>
  )
}

MobileDots.propTypes = {
  cell: calendarCellShape.isRequired,
  members: PropTypes.arrayOf(memberShape).isRequired,
}

function GigBar({ gig, theme, onGigClick }) {
  const backgroundColor = GIG_STATUS_COLORS[gig.status] || 'grey.500'
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

GigBar.propTypes = { gig: gigShape.isRequired, theme: PropTypes.object.isRequired, onGigClick: PropTypes.func }

function RehearsalBar({ reh, theme, onRehearsalClick }) {
  const yes = reh.participants?.filter((p) => p.vote === 'yes').length ?? 0
  const total = reh.participants?.length ?? 0
  const isOption = reh.status === 'option'
  const backgroundColor = REHEARSAL_STATUS_COLORS[reh.status] || 'grey.400'
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

RehearsalBar.propTypes = { reh: rehearsalShape.isRequired, theme: PropTypes.object.isRequired, onRehearsalClick: PropTypes.func }

function BandEventBar({ ev, theme, onBandEventClick }) {
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

BandEventBar.propTypes = { ev: bandEventShape.isRequired, theme: PropTypes.object.isRequired, onBandEventClick: PropTypes.func }

function SlotBar({ slot, members, theme, onSlotClick }) {
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

SlotBar.propTypes = {
  slot: slotShape.isRequired,
  members: PropTypes.arrayOf(memberShape).isRequired,
  theme: PropTypes.object.isRequired,
  onSlotClick: PropTypes.func.isRequired,
}

function DesktopEvents({ cell, members, theme, onGigClick, onRehearsalClick, onBandEventClick, onSlotClick }) {
  return (
    <>
      <Stack spacing={0.375} sx={{ mt: 0.25 }}>
        {cell.cellGigs.map((gig) => (
          <GigBar key={gig.id} gig={gig} theme={theme} onGigClick={onGigClick} />
        ))}
        {cell.cellRehearsals.map((reh) => (
          <RehearsalBar key={`reh-${reh.id}`} reh={reh} theme={theme} onRehearsalClick={onRehearsalClick} />
        ))}
        {cell.cellBandEvents.map((ev) => (
          <BandEventBar key={`be-${ev.id}`} ev={ev} theme={theme} onBandEventClick={onBandEventClick} />
        ))}
      </Stack>
      <Stack spacing={0.375} sx={{ mt: 0.375 }}>
        {cell.cellSlots.map((slot) => (
          <SlotBar key={slot.id} slot={slot} members={members} theme={theme} onSlotClick={onSlotClick} />
        ))}
      </Stack>
    </>
  )
}

DesktopEvents.propTypes = {
  cell: calendarCellShape.isRequired,
  members: PropTypes.arrayOf(memberShape).isRequired,
  theme: PropTypes.object.isRequired,
  onGigClick: PropTypes.func,
  onRehearsalClick: PropTypes.func,
  onBandEventClick: PropTypes.func,
  onSlotClick: PropTypes.func.isRequired,
}

export default function CalendarCell({
  cell, members, mobile, onDayClick, onSlotClick, onGigClick, onRehearsalClick, onBandEventClick,
}) {
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
        <DayNumber date={date} mobile={mobile} isToday={isToday} isSelected={isSelected} inMonth={inMonth} theme={theme} />
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

CalendarCell.propTypes = {
  cell: calendarCellShape.isRequired,
  members: PropTypes.arrayOf(memberShape).isRequired,
  mobile: PropTypes.bool,
  onDayClick: PropTypes.func.isRequired,
  onSlotClick: PropTypes.func.isRequired,
  onGigClick: PropTypes.func,
  onRehearsalClick: PropTypes.func,
  onBandEventClick: PropTypes.func,
}
