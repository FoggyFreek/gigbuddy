import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Fab from '@mui/material/Fab'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import EventAvailableIcon from '@mui/icons-material/EventAvailable'
import EventNoteIcon from '@mui/icons-material/EventNote'
import MicIcon from '@mui/icons-material/Mic'
import AvailabilityCalendar from './AvailabilityCalendar.tsx'
import AvailabilitySlotDialog from './AvailabilitySlotDialog.tsx'
import BandEventFormModal from './BandEventFormModal.tsx'
import GigFormModal from './GigFormModal.tsx'
import { buildCalendarCells } from './calendar/calendarGrid.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { listMyAgenda, type AgendaItem, type AgendaItemType } from '../api/me.ts'
import {
  createMyAvailability,
  deleteMyAvailability,
  listMyAvailability,
  updateMyAvailability,
  type UserAvailabilitySlot,
} from '../api/userAvailability.ts'
import { toIsoDate } from '../utils/availabilityUtils.ts'
import type { BandEvent, Gig, Id, Member, Rehearsal, Slot, UnassignedSlotLane } from '../types/entities.ts'

// A personal workspace has no roster, so its slots carry no band_member_id at
// all; the calendar's "no member" lane is relabelled as the artist instead.
const SELF_LANE_COLOR = '#5c6bc0'
const NO_MEMBERS: Member[] = []

const ITEM_PATH: Record<AgendaItemType, string> = {
  gig: '/gigs',
  rehearsal: '/rehearsals',
  band_event: '/events',
}

function calendarBounds(year: number, month: number) {
  const cells = buildCalendarCells(year, month)
  return { from: cells[0].iso, to: cells[cells.length - 1].iso }
}

function asSlot(slot: UserAvailabilitySlot): Slot {
  return {
    ...slot,
    band_member_id: null,
    source: 'slot',
    createdByUserId: slot.created_by_user_id,
    createdInTenantId: slot.created_in_tenant_id,
  }
}

async function fetchCalendar(year: number, month: number) {
  const bounds = calendarBounds(year, month)
  const [events, availability] = await Promise.all([
    listMyAgenda(bounds),
    listMyAvailability(bounds),
  ])
  return { agenda: events.items, slots: availability.items.map(asSlot) }
}

interface ArtistCalendarSectionProps {
  eventReloadKey?: number
}

export default function ArtistCalendarSection({ eventReloadKey = 0 }: Readonly<ArtistCalendarSectionProps>) {
  const { t, i18n } = useTranslation('availability')
  const navigate = useNavigate()
  const isCompact = useCompactLayout()
  const today = useMemo(() => new Date(), [])
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1)
  const [selectedDay, setSelectedDay] = useState(toIsoDate(today))
  const [selectionStart, setSelectionStart] = useState<string | null>(null)
  const [agenda, setAgenda] = useState<AgendaItem[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [slotDialog, setSlotDialog] = useState<{ slot: Partial<Slot> } | null>(null)
  const [addMenu, setAddMenu] = useState<{ anchorEl: Element; date: string } | null>(null)
  const [createModal, setCreateModal] = useState<{ type: 'event' | 'gig'; date: string } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const fabRef = useRef<HTMLButtonElement | null>(null)

  const selfLane = useMemo<UnassignedSlotLane>(
    () => ({ name: t($ => $.events.me), color: SELF_LANE_COLOR }),
    [t],
  )

  async function reloadCalendar() {
    try {
      const loaded = await fetchCalendar(viewYear, viewMonth)
      setAgenda(loaded.agenda)
      setSlots(loaded.slots)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }

  useEffect(() => {
    let cancelled = false
    void fetchCalendar(viewYear, viewMonth)
      .then((loaded) => {
        if (cancelled) return
        setAgenda(loaded.agenda)
        setSlots(loaded.slots)
        setLoadFailed(false)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => { cancelled = true }
  }, [viewYear, viewMonth, eventReloadKey])

  const gigs = useMemo<Gig[]>(() => agenda.filter((item) => item.type === 'gig').map((item) => ({
    id: item.id,
    event_date: item.date,
    event_description: item.description ?? item.title ?? undefined,
    status: item.status ?? undefined,
    start_time: item.startTime,
    end_time: item.endTime,
  })), [agenda])

  const rehearsals = useMemo<Rehearsal[]>(() => agenda.filter((item) => item.type === 'rehearsal').map((item) => ({
    id: item.id,
    proposed_date: item.date,
    location: item.location ?? undefined,
    calendar_description: item.description ?? undefined,
    status: item.status ?? undefined,
    start_time: item.startTime ?? undefined,
    end_time: item.endTime ?? undefined,
  })), [agenda])

  const bandEvents = useMemo<BandEvent[]>(() => agenda.filter((item) => item.type === 'band_event').map((item) => ({
    id: item.id,
    title: item.description ?? item.title ?? undefined,
    start_date: item.date,
    end_date: item.endDate,
    location: item.location ?? undefined,
  })), [agenda])

  function openItem(type: AgendaItemType, id: Id) {
    navigate(`/availability${ITEM_PATH[type]}/${id}`)
  }

  function handleDayClick(date: string, shiftKey: boolean, target: EventTarget | null) {
    setSelectedDay(date)
    if (isCompact) return
    if (shiftKey && selectionStart && date >= selectionStart) {
      setSlotDialog({ slot: {
        start_date: selectionStart, end_date: date, status: 'unavailable', reason: null,
      } })
      setSelectionStart(null)
      return
    }
    setSelectionStart(date)
    setAddMenu({ anchorEl: target as Element, date })
  }

  function openAddMenu(anchorEl: Element, date: string) {
    setSelectedDay(date)
    setAddMenu({ anchorEl, date })
  }

  function chooseAdd(type: 'availability' | 'event' | 'gig') {
    const date = addMenu?.date ?? selectedDay
    setAddMenu(null)
    if (type === 'availability') {
      setSlotDialog({ slot: { start_date: date, end_date: date, status: 'unavailable', reason: null } })
    } else {
      setCreateModal({ type, date })
    }
  }

  function closeCreateModal() {
    setCreateModal(null)
    void reloadCalendar()
  }

  async function saveSlot(data: Partial<Slot>) {
    const body = {
      start_date: data.start_date,
      end_date: data.end_date,
      status: data.status as UserAvailabilitySlot['status'],
      reason: data.reason ?? null,
    }
    if (slotDialog?.slot.id) await updateMyAvailability(slotDialog.slot.id, body)
    else await createMyAvailability(body)
    setSlotDialog(null)
    setSelectionStart(null)
    await reloadCalendar()
  }

  async function removeSlot(id: Id) {
    await deleteMyAvailability(id)
    setSlotDialog(null)
    await reloadCalendar()
  }

  const dayItems = agenda.filter((item) => selectedDay >= item.date && selectedDay <= item.endDate)
  const daySlots = slots.filter((slot) => selectedDay >= (slot.start_date ?? '') && selectedDay <= (slot.end_date ?? ''))

  return (
    <Box>
      {loadFailed && <Alert severity="error" sx={{ mb: 2 }}>{t($ => $.mine.loadFailed)}</Alert>}
      <AvailabilityCalendar
        summarizeAvailability={false}
        year={viewYear}
        month={viewMonth}
        slots={slots}
        gigs={gigs}
        rehearsals={rehearsals}
        bandEvents={bandEvents}
        members={NO_MEMBERS}
        unassignedLane={selfLane}
        mobile={isCompact}
        selectedDay={selectedDay}
        selectionStart={selectionStart ?? undefined}
        onDayClick={handleDayClick}
        onSlotClick={(slot) => setSlotDialog({ slot })}
        onGigClick={(gig) => openItem('gig', gig.id!)}
        onRehearsalClick={(rehearsal) => openItem('rehearsal', rehearsal.id!)}
        onBandEventClick={(event) => openItem('band_event', event.id!)}
        onPrev={() => {
          if (viewMonth === 1) { setViewYear((year) => year - 1); setViewMonth(12) }
          else setViewMonth((month) => month - 1)
        }}
        onNext={() => {
          if (viewMonth === 12) { setViewYear((year) => year + 1); setViewMonth(1) }
          else setViewMonth((month) => month + 1)
        }}
        onMonthJump={(year, month) => { setViewYear(year); setViewMonth(month) }}
      />

      {isCompact && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {new Date(`${selectedDay}T00:00:00`).toLocaleDateString(i18n.resolvedLanguage ?? 'en', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </Typography>
          <List dense disablePadding>
            {dayItems.map((item) => (
              <ListItemButton key={`${item.type}-${item.id}`} onClick={() => openItem(item.type, item.id)}>
                <ListItemText primary={item.description ?? item.title} secondary={item.location} />
              </ListItemButton>
            ))}
            {daySlots.map((slot) => (
              <ListItemButton key={`slot-${slot.id}`} onClick={() => setSlotDialog({ slot })}>
                <ListItemText primary={t($ => $.events.myAvailability)} secondary={[slot.status, slot.reason].filter(Boolean).join(' — ')} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      )}

      {isCompact && (
        <Fab
          ref={fabRef}
          color="primary"
          aria-label={t($ => $.addEventAria)}
          onClick={(event) => openAddMenu(event.currentTarget, selectedDay)}
          sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: (theme) => theme.zIndex.fab }}
        >
          <AddIcon />
        </Fab>
      )}

      <Menu open={Boolean(addMenu)} anchorEl={addMenu?.anchorEl ?? null} onClose={() => setAddMenu(null)}>
        <MenuItem onClick={() => chooseAdd('availability')}>
          <ListItemIcon><EventAvailableIcon fontSize="small" /></ListItemIcon>
          {t($ => $.addMenu.availability)}
        </MenuItem>
        <MenuItem onClick={() => chooseAdd('gig')}>
          <ListItemIcon><MicIcon fontSize="small" /></ListItemIcon>
          {t($ => $.addMenu.gig)}
        </MenuItem>
        <MenuItem onClick={() => chooseAdd('event')}>
          <ListItemIcon><EventNoteIcon fontSize="small" /></ListItemIcon>
          {t($ => $.addMenu.artistEvent)}
        </MenuItem>
      </Menu>

      {slotDialog && (
        <AvailabilitySlotDialog
          open
          personal
          slot={slotDialog.slot}
          members={[]}
          onSave={saveSlot}
          onDelete={removeSlot}
          onClose={() => { setSlotDialog(null); setSelectionStart(null) }}
        />
      )}

      {createModal?.type === 'event' && (
        <BandEventFormModal
          mode="create"
          initialDate={createModal.date}
          onClose={closeCreateModal}
        />
      )}

      {createModal?.type === 'gig' && (
        <GigFormModal
          mode="create"
          initialDate={createModal.date}
          onClose={closeCreateModal}
        />
      )}
    </Box>
  )
}
