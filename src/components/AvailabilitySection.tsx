import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import ListItemIcon from '@mui/material/ListItemIcon'
import Fab from '@mui/material/Fab'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import AddIcon from '@mui/icons-material/Add'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import MicIcon from '@mui/icons-material/Mic'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import GroupIcon from '@mui/icons-material/Group'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import AvailabilityCalendar from './AvailabilityCalendar.tsx'
import { venueHeadline } from '../utils/venueDisplay.ts'
import {
  GIG_STATUS_COLORS,
  REHEARSAL_STATUS_COLORS,
  BAND_EVENT_COLOR,
  getMemberColor,
  normalizeIsoDate,
  toIsoDate,
} from '../utils/availabilityUtils.ts'
import AvailabilitySlotDialog from './AvailabilitySlotDialog.tsx'
import GigFormModal from './GigFormModal.tsx'
import RehearsalFormModal from './RehearsalFormModal.tsx'
import BandEventFormModal from './BandEventFormModal.tsx'
import { buildCalendarCells } from './calendar/calendarGrid.ts'
import { listMembers } from '../api/bandMembers.ts'
import { createSlot, deleteSlot, listAvailability, updateSlot } from '../api/availability.ts'
import { getGig, listGigsInRange } from '../api/gigs.ts'
import { getRehearsal, listRehearsalsInRange } from '../api/rehearsals.ts'
import { getBandEvent, listBandEventsInRange } from '../api/bandEvents.ts'
import { exportMonthToICS } from '../utils/shareUtils.ts'
import { useProfile } from '../contexts/profileContext.ts'
import CalendarFeedDialog from './appShell/CalendarFeedDialog.tsx'
import type { Gig, Member, BandEvent, Slot, Rehearsal, Id } from '../types/entities.ts'

interface AvailabilitySectionProps {
  basePath?: string
  eventReloadKey?: number
}

function calendarBounds(year: number, month: number) {
  const cells = buildCalendarCells(year, month)
  return { from: cells[0].iso, to: cells[cells.length - 1].iso }
}

export default function AvailabilitySection({ basePath = '', eventReloadKey = 0 }: AvailabilitySectionProps = {}) {
  const { t, i18n } = useTranslation(['availability', 'common'])
  const isMobile = useCompactLayout()
  const { bandName } = useProfile()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const gigHref = (id: Id) => (basePath ? `${basePath}/gigs/${id}` : `/gigs/${id}`)
  const rehHref = (id: Id) => (basePath ? `${basePath}/rehearsals/${id}` : `/rehearsals/${id}`)
  const evHref = (id: Id) => (basePath ? `${basePath}/events/${id}` : `/events/${id}`)
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)
  const [members, setMembers] = useState<Member[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [gigs, setGigs] = useState<Gig[]>([])
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([])
  const [bandEvents, setBandEvents] = useState<BandEvent[]>([])
  const [selectionStart, setSelectionStart] = useState<string | null>(null)
  const [selectedDay, setSelectedDay] = useState<string>(toIsoDate(new Date()))
  const [dialog, setDialog] = useState<{ slot: Partial<Slot> } | null>(null)
  const [addMenu, setAddMenu] = useState<{ anchorEl: EventTarget & Element; date: string } | null>(null)
  const [createModal, setCreateModal] = useState<{ type: string; date: string } | null>(null)
  const [exportModal, setExportModal] = useState(false)
  const [calendarFeedOpen, setCalendarFeedOpen] = useState(false)
  const [exportOptions, setExportOptions] = useState({ gigs: true, rehearsals: true, bandEvents: true })
  const fabRef = useRef<HTMLButtonElement | null>(null)
  const escapedBasePath = basePath.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')
  const focusMatch = basePath
    ? new RegExp(`^${escapedBasePath}/(gigs|rehearsals|events)/(\\d+)`).exec(pathname)
    : null
  const focusType = focusMatch?.[1] ?? null
  const focusId = focusMatch ? Number(focusMatch[2]) : null
  let loadedFocusDate: string | null = null
  if (focusType === 'gigs') {
    loadedFocusDate = normalizeIsoDate(gigs.find((gig) => gig.id === focusId)?.event_date)
  } else if (focusType === 'rehearsals') {
    loadedFocusDate = normalizeIsoDate(rehearsals.find((rehearsal) => rehearsal.id === focusId)?.proposed_date)
  } else if (focusType === 'events') {
    loadedFocusDate = normalizeIsoDate(bandEvents.find((event) => event.id === focusId)?.start_date)
  }

  function loadGigs() {
    listGigsInRange(calendarBounds(viewYear, viewMonth)).then((res) => setGigs(res.items)).catch(() => {})
  }

  function loadRehearsals() {
    listRehearsalsInRange(calendarBounds(viewYear, viewMonth)).then((res) => setRehearsals(res.items)).catch(() => {})
  }

  function loadBandEvents() {
    listBandEventsInRange(calendarBounds(viewYear, viewMonth)).then((res) => setBandEvents(res.items)).catch(() => {})
  }

  useEffect(() => {
    listMembers().then(setMembers).catch(() => {})
  }, [eventReloadKey])

  useEffect(() => {
    const bounds = calendarBounds(viewYear, viewMonth)
    listGigsInRange(bounds).then((res) => setGigs(res.items)).catch(() => {})
    listRehearsalsInRange(bounds).then((res) => setRehearsals(res.items)).catch(() => {})
    listBandEventsInRange(bounds).then((res) => setBandEvents(res.items)).catch(() => {})
    listAvailability(bounds).then(setSlots).catch(() => {})
  }, [viewYear, viewMonth, eventReloadKey])

  // Sync calendar focus to the item opened in the split-view detail pane
  // (URL is the source of truth; deep links may fall outside the loaded grid).
  useEffect(() => {
    if (!focusType || focusId === null) return
    let cancelled = false

    function focusDate(dateStr: string | null) {
      if (cancelled || !dateStr) return
      setSelectedDay(dateStr)
      const [yStr, mStr] = dateStr.split('-')
      setViewYear(Number(yStr))
      setViewMonth(Number(mStr))
    }

    if (loadedFocusDate) {
      focusDate(loadedFocusDate)
      return
    }

    let lookup: Promise<string | null>
    if (focusType === 'gigs') {
      lookup = getGig(focusId).then((gig) => normalizeIsoDate(gig.event_date))
    } else if (focusType === 'rehearsals') {
      lookup = getRehearsal(focusId).then((rehearsal) => normalizeIsoDate(rehearsal.proposed_date))
    } else {
      lookup = getBandEvent(focusId).then((event) => normalizeIsoDate(event.start_date))
    }
    lookup.then(focusDate).catch(() => {})

    return () => { cancelled = true }
  }, [focusType, focusId, loadedFocusDate])

  function handlePrev() {
    if (viewMonth === 1) { setViewYear((y) => y - 1); setViewMonth(12) }
    else setViewMonth((m) => m - 1)
  }

  function handleNext() {
    if (viewMonth === 12) { setViewYear((y) => y + 1); setViewMonth(1) }
    else setViewMonth((m) => m + 1)
  }

  function handleDayClick(dateStr: string, shiftKey: boolean, targetEl: EventTarget | null) {
    if (isMobile) {
      setSelectedDay(dateStr)
      return
    }
    if (shiftKey && selectionStart && dateStr >= selectionStart) {
      setDialog({ slot: { band_member_id: null, start_date: selectionStart, end_date: dateStr, status: 'available', reason: '' } })
      setSelectionStart(null)
    } else if (shiftKey) {
      setSelectionStart(dateStr)
    } else {
      setSelectionStart(dateStr)
      setAddMenu({ anchorEl: targetEl as EventTarget & Element, date: dateStr })
    }
  }

  function handleSlotClick(slot: Slot) {
    setDialog({ slot })
  }

  function handleFabClick(e: React.MouseEvent<HTMLButtonElement>) {
    const day = selectedDay || toIsoDate(new Date())
    setAddMenu({ anchorEl: e.currentTarget, date: day })
  }

  function handleMenuSelect(type: string) {
    const date = addMenu?.date
    setAddMenu(null)
    if (type === 'availability') {
      setDialog({ slot: { band_member_id: null, start_date: date, end_date: date, status: 'available', reason: '' } })
    } else {
      setCreateModal({ type, date: date ?? '' })
    }
  }

  async function handleSave(data: Partial<Slot>) {
    const { from, to } = calendarBounds(viewYear, viewMonth)
    if (dialog?.slot?.id) {
      await updateSlot(dialog.slot.id, data)
    } else {
      await createSlot(data)
    }
    const updated = await listAvailability({ from, to })
    setSlots(updated)
    setDialog(null)
    setSelectionStart(null)
  }

  async function handleDelete(id: Id) {
    await deleteSlot(id)
    setSlots((prev) => prev.filter((s) => s.id !== id))
    setDialog(null)
  }

  const dayGigs = selectedDay
    ? gigs.filter((g) => normalizeIsoDate(g.event_date) === selectedDay)
    : []
  const dayRehearsals = selectedDay
    ? rehearsals.filter((r) => normalizeIsoDate(r.proposed_date) === selectedDay)
    : []
  const dayBandEvents = selectedDay
    ? bandEvents.filter((ev) => {
        const start = normalizeIsoDate(ev.start_date)
        const end = normalizeIsoDate(ev.end_date) || start
        return selectedDay >= start && selectedDay <= end
      })
    : []
  const daySlots = selectedDay
    ? slots.filter((s) => selectedDay >= (s.start_date ?? '') && selectedDay <= (s.end_date ?? ''))
    : []

  return (
    <Box sx={{ mb: 3 }}>
      <AvailabilityCalendar
        year={viewYear}
        month={viewMonth}
        slots={slots}
        gigs={gigs}
        rehearsals={rehearsals}
        bandEvents={bandEvents}
        members={members}
        mobile={isMobile}
        selectedDay={selectedDay}
        selectionStart={selectionStart ?? undefined}
        onDayClick={handleDayClick}
        onSlotClick={handleSlotClick}
        onGigClick={(gig) => navigate(gigHref(gig.id!))}
        onRehearsalClick={(reh) => navigate(rehHref(reh.id!))}
        onBandEventClick={(ev) => navigate(evHref(ev.id!))}
        onPrev={handlePrev}
        onNext={handleNext}
        onMonthJump={(y, m) => { setViewYear(y); setViewMonth(m) }}
        onExport={() => setExportModal(true)}
        onSubscribe={() => setCalendarFeedOpen(true)}
      />

      {isMobile && selectedDay && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {new Date(selectedDay + 'T00:00:00').toLocaleDateString(i18n.resolvedLanguage ?? 'en', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Typography>
          {dayGigs.length === 0 && dayRehearsals.length === 0 && dayBandEvents.length === 0 && daySlots.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{t($ => $.events.noEvents)}</Typography>
          ) : (
            <List dense disablePadding>
              {dayGigs.map((gig) => (
                <ListItemButton key={`g-${gig.id}`} onClick={() => navigate(gigHref(gig.id!))}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: GIG_STATUS_COLORS[gig.status as string] || 'grey.500',
                      mr: 1.5,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary={gig.event_description || venueHeadline(gig.venue ?? gig.festival) || t($ => $.events.gigFallback)}
                    secondary={[venueHeadline(gig.venue ?? gig.festival), gig.status].filter(Boolean).join(' — ')}
                  />
                </ListItemButton>
              ))}
              {dayRehearsals.map((reh) => {
                const yes = reh.participants?.filter((p) => p.vote === 'yes').length ?? 0
                const total = reh.participants?.length ?? 0
                return (
                  <ListItemButton key={`r-${reh.id}`} onClick={() => navigate(rehHref(reh.id!))}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: REHEARSAL_STATUS_COLORS[reh.status as string] || 'grey.400',
                        mr: 1.5,
                        flexShrink: 0,
                      }}
                    />
                    <ListItemText
                      primary={t($ => $.events.rehearsalTooltip, { status: reh.status })}
                      secondary={[reh.location, t($ => $.events.votesYes, { yes, total })].filter(Boolean).join(' — ')}
                    />
                  </ListItemButton>
                )
              })}
              {dayBandEvents.map((ev) => (
                <ListItemButton key={`be-${ev.id}`} onClick={() => navigate(evHref(ev.id!))}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: BAND_EVENT_COLOR,
                      mr: 1.5,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary={ev.title}
                    secondary={ev.location || null}
                  />
                </ListItemButton>
              ))}
              {daySlots.map((slot) => {
                const member = slot.band_member_id === null
                  ? null
                  : members.find((m) => m.id === slot.band_member_id)
                const name = slot.band_member_id === null ? t($ => $.events.band) : member?.name || ''
                return (
                  <ListItemButton key={`s-${slot.id}`} onClick={() => handleSlotClick(slot)}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: getMemberColor(slot, members),
                        mr: 1.5,
                        flexShrink: 0,
                      }}
                    />
                    <ListItemText
                      primary={name}
                      secondary={[slot.status, slot.reason].filter(Boolean).join(' — ')}
                    />
                  </ListItemButton>
                )
              })}
            </List>
          )}
        </Box>
      )}

      {isMobile && (
        <Fab
          ref={fabRef}
          color="primary"
          aria-label={t($ => $.addEventAria)}
          onClick={handleFabClick}
          sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: (t) => t.zIndex.fab }}
        >
          <AddIcon />
        </Fab>
      )}

      <Menu
        open={Boolean(addMenu)}
        anchorEl={addMenu?.anchorEl as Element | null}
        onClose={() => setAddMenu(null)}
        anchorOrigin={isMobile
          ? { vertical: 'top', horizontal: 'center' }
          : { vertical: 'center', horizontal: 'center' }
        }
        transformOrigin={isMobile
          ? { vertical: 'bottom', horizontal: 'center' }
          : { vertical: 'center', horizontal: 'center' }
        }
      >
        <MenuItem onClick={() => handleMenuSelect('availability')}>
          <ListItemIcon><EventAvailableIcon fontSize="small" /></ListItemIcon>
          {t($ => $.addMenu.availability)}
        </MenuItem>
        <MenuItem onClick={() => handleMenuSelect('gig')}>
          <ListItemIcon><MicIcon fontSize="small" /></ListItemIcon>
          {t($ => $.addMenu.gig)}
        </MenuItem>
        <MenuItem onClick={() => handleMenuSelect('rehearsal')}>
          <ListItemIcon><MusicNoteIcon fontSize="small" /></ListItemIcon>
          {t($ => $.addMenu.rehearsal)}
        </MenuItem>
        <MenuItem onClick={() => handleMenuSelect('bandEvent')}>
          <ListItemIcon><GroupIcon fontSize="small" /></ListItemIcon>
          {t($ => $.addMenu.bandEvent)}
        </MenuItem>
      </Menu>

      {createModal?.type === 'gig' && (
         
        <GigFormModal
          mode="create"
          gigId={undefined}
          initialDate={createModal.date}
          onClose={() => { setCreateModal(null); loadGigs() }}
        />
      )}

      {createModal?.type === 'rehearsal' && (
         
        <RehearsalFormModal
          mode="create"
          rehearsalId={undefined}
          initialDate={createModal.date}
          onClose={() => { setCreateModal(null); loadRehearsals() }}
        />
      )}

      {createModal?.type === 'bandEvent' && (
        <BandEventFormModal
          mode="create"
          initialDate={createModal.date}
          onClose={() => { setCreateModal(null); loadBandEvents() }}
        />
      )}

      {dialog && (
        <AvailabilitySlotDialog
          open
          slot={dialog.slot}
          members={members}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => { setDialog(null); setSelectionStart(null) }}
        />
      )}

      <CalendarFeedDialog open={calendarFeedOpen} onClose={() => setCalendarFeedOpen(false)} />

      <Dialog open={exportModal} onClose={() => setExportModal(false)}>
        <DialogTitle>{t($ => $.exportDialog.title)}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t($ => $.exportDialog.intro, {
              month: new Date(viewYear, viewMonth - 1, 1).toLocaleString(i18n.resolvedLanguage ?? 'en', { month: 'long', year: 'numeric' }),
            })}
          </Typography>
          <FormGroup>
            <FormControlLabel
              control={
                <Checkbox
                  checked={exportOptions.gigs}
                  onChange={(e) => setExportOptions((o) => ({ ...o, gigs: e.target.checked }))}
                />
              }
              label={t($ => $.exportDialog.gigs)}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={exportOptions.rehearsals}
                  onChange={(e) => setExportOptions((o) => ({ ...o, rehearsals: e.target.checked }))}
                />
              }
              label={t($ => $.exportDialog.rehearsals)}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={exportOptions.bandEvents}
                  onChange={(e) => setExportOptions((o) => ({ ...o, bandEvents: e.target.checked }))}
                />
              }
              label={t($ => $.exportDialog.bandEvents)}
            />
          </FormGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            {t($ => $.exportDialog.note)}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExportModal(false)}>{t($ => $.actions.cancel, { ns: 'common' })}</Button>
          <Button
            variant="contained"
            disabled={!exportOptions.gigs && !exportOptions.rehearsals && !exportOptions.bandEvents}
            onClick={() => {
              exportMonthToICS(
                exportOptions.gigs ? gigs.filter((g) => g.status !== 'option') : [],
                exportOptions.rehearsals ? rehearsals.filter((r) => r.status !== 'option') : [],
                exportOptions.bandEvents ? bandEvents : [],
                viewYear,
                viewMonth,
                bandName || undefined,
              )
              setExportModal(false)
            }}
          >
            {t($ => $.exportDialog.export)}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
