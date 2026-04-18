import React from 'react'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import {
  GIG_STATUS_COLORS,
  REHEARSAL_STATUS_COLORS,
  toIsoDate,
  normalizeIsoDate,
  getMemberColor,
} from './availabilityUtils.js'

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function inRange(dateStr, start, end) {
  return dateStr >= start && dateStr <= end
}

function buildCalendarCells(year, month) {
  const firstOfMonth = new Date(year, month - 1, 1)
  // day-of-week Monday=0, Sunday=6
  let dow = firstOfMonth.getDay() - 1
  if (dow < 0) dow = 6
  const start = addDays(firstOfMonth, -dow)
  return Array.from({ length: 42 }, (_, i) => {
    const d = addDays(start, i)
    return { date: d, iso: toIsoDate(d), inMonth: d.getMonth() === month - 1 }
  })
}

export default function AvailabilityCalendar({
  year,
  month,
  slots,
  gigs = [],
  rehearsals = [],
  members,
  selectionStart,
  selectedDay,
  mobile = false,
  onDayClick,
  onSlotClick,
  onGigClick,
  onRehearsalClick,
  onPrev,
  onNext,
}) {
  const cells = buildCalendarCells(year, month)
  const gigsByDate = gigs.reduce((acc, g) => {
    const key = normalizeIsoDate(g.event_date)
    if (!key) return acc
    ;(acc[key] ||= []).push(g)
    return acc
  }, {})
  const rehearsalsByDate = rehearsals.reduce((acc, r) => {
    const key = normalizeIsoDate(r.proposed_date)
    if (!key) return acc
    ;(acc[key] ||= []).push(r)
    return acc
  }, {})
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })

  return (
    <Box sx={{ maxWidth: 1024, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <IconButton size="small" onClick={onPrev} aria-label="previous month">
          <ChevronLeftIcon />
        </IconButton>
        <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1, textAlign: 'center' }}>
          {monthLabel}
        </Typography>
        <IconButton size="small" onClick={onNext} aria-label="next month">
          <ChevronRightIcon />
        </IconButton>
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: '28px repeat(7, 1fr)', gap: 0 }}>
        <Typography variant="caption" align="center" color="text.secondary" sx={{ py: 0.5 }}>
          Wk
        </Typography>
        {DAY_HEADERS.map((d) => (
          <Typography key={d} variant="caption" align="center" color="text.secondary" sx={{ py: 0.5 }}>
            {d}
          </Typography>
        ))}

        {cells.map(({ iso, date, inMonth }, idx) => {
          const isRowStart = idx % 7 === 0
          const cellSlots = slots.filter((s) => inRange(iso, s.start_date, s.end_date))
          const cellGigs = gigsByDate[iso] || []
          const cellRehearsals = rehearsalsByDate[iso] || []
          const isSelected = selectionStart === iso || (mobile && selectedDay === iso)
          const dow = date.getDay()
          const isWeekend = dow === 0 || dow === 6

          let bgcolor = 'background.paper'
          if (mobile) {
            bgcolor = 'transparent'
          } else if (isSelected) bgcolor = 'action.selected'
          else if (!inMonth) bgcolor = 'action.hover'
          else if (isWeekend) bgcolor = 'grey.200'

          return (
            <React.Fragment key={iso}>
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
                  {getISOWeek(date)}
                </Typography>
              )}
            <Box
              data-date={iso}
              onClick={(e) => onDayClick(iso, e.shiftKey)}
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
              {mobile ? (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    bgcolor: isSelected ? 'primary.main' : 'transparent',
                    color: isSelected
                      ? 'primary.contrastText'
                      : (inMonth ? 'text.primary' : 'text.disabled'),
                  }}
                >
                  <Typography variant="caption" sx={{ lineHeight: 1, color: 'inherit' }}>
                    {date.getDate()}
                  </Typography>
                </Box>
              ) : (
                <Typography
                  variant="caption"
                  sx={{ display: 'block', color: inMonth ? 'text.primary' : 'text.disabled' }}
                >
                  {date.getDate()}
                </Typography>
              )}
              {mobile ? (
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ mt: 0.5, justifyContent: 'center', flexWrap: 'wrap', gap: 0.5, rowGap: 0.25 }}
                >
                  {cellGigs.map((gig) => (
                    <Box
                      key={`g-${gig.id}`}
                      data-gig-id={gig.id}
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: GIG_STATUS_COLORS[gig.status] || 'grey.500',
                      }}
                    />
                  ))}
                  {cellRehearsals.map((reh) => (
                    <Box
                      key={`r-${reh.id}`}
                      data-rehearsal-id={reh.id}
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: REHEARSAL_STATUS_COLORS[reh.status] || 'grey.400',
                        opacity: reh.status === 'option' ? 0.7 : 1,
                      }}
                    />
                  ))}
                  {cellSlots.map((slot) => (
                    <Box
                      key={`s-${slot.id}`}
                      data-slot-id={slot.id}
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: getMemberColor(slot, members),
                      }}
                    />
                  ))}
                </Stack>
              ) : (
                <>
                  <Stack spacing={0.375} sx={{ mt: 0.25 }}>
                    {cellGigs.map((gig) => (
                      <Tooltip
                        key={gig.id}
                        title={[
                          gig.event_description,
                          gig.venue,
                          gig.status,
                        ].filter(Boolean).join(' — ')}
                      >
                        <Box
                          data-gig-id={gig.id}
                          onClick={(e) => { e.stopPropagation(); onGigClick?.(gig) }}
                          sx={{
                            minHeight: 20,
                            width: '100%',
                            px: 0.5,
                            py: 0.25,
                            borderRadius: 0.5,
                            bgcolor: GIG_STATUS_COLORS[gig.status] || 'grey.500',
                            color: 'common.white',
                            cursor: onGigClick ? 'pointer' : 'default',
                            fontSize: '0.7rem',
                            lineHeight: 1.2,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {gig.event_description || gig.venue || 'Gig'}
                        </Box>
                      </Tooltip>
                    ))}
                    {cellRehearsals.map((reh) => {
                      const yes = reh.participants?.filter((p) => p.vote === 'yes').length ?? 0
                      const total = reh.participants?.length ?? 0
                      const isOption = reh.status === 'option'
                      return (
                        <Tooltip
                          key={`reh-${reh.id}`}
                          title={[
                            `Rehearsal — ${reh.status}`,
                            reh.location,
                            `${yes}/${total} yes`,
                          ].filter(Boolean).join(' — ')}
                        >
                          <Box
                            data-rehearsal-id={reh.id}
                            onClick={(e) => { e.stopPropagation(); onRehearsalClick?.(reh) }}
                            sx={{
                              minHeight: 20,
                              width: '100%',
                              px: 0.5,
                              py: 0.25,
                              borderRadius: 0.5,
                              bgcolor: isOption ? 'transparent' : (REHEARSAL_STATUS_COLORS[reh.status] || 'grey.400'),
                              border: isOption ? '1px dashed' : 'none',
                              borderColor: isOption ? 'grey.500' : 'transparent',
                              color: isOption ? 'text.primary' : 'common.white',
                              cursor: onRehearsalClick ? 'pointer' : 'default',
                              fontSize: '0.7rem',
                              lineHeight: 1.2,
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {`Reh ${yes}/${total}`}
                          </Box>
                        </Tooltip>
                      )
                    })}
                  </Stack>
                  <Stack spacing={0.375} sx={{ mt: 0.375 }}>
                    {cellSlots.map((slot) => {
                      const color = getMemberColor(slot, members)
                      const isUnavailable = slot.status === 'unavailable'
                      const memberName = slot.band_member_id === null
                        ? 'Band'
                        : members.find((m) => m.id === slot.band_member_id)?.name || ''
                      return (
                        <Tooltip
                          key={slot.id}
                          title={[
                            slot.band_member_id === null ? 'Band-wide' : memberName,
                            slot.status,
                            slot.reason,
                          ].filter(Boolean).join(' — ')}
                        >
                          <Box
                            data-slot-id={slot.id}
                            onClick={(e) => { e.stopPropagation(); onSlotClick(slot) }}
                            sx={{
                              minHeight: 20,
                              width: '100%',
                              px: 0.5,
                              py: 0.25,
                              borderRadius: 0.5,
                              bgcolor: color,
                              color: 'common.white',
                              fontSize: '0.7rem',
                              lineHeight: 1.2,
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
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
                    })}
                  </Stack>
                </>
              )}
            </Box>
            </React.Fragment>
          )
        })}
      </Box>
    </Box>
  )
}
