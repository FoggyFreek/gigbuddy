import React from 'react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Skeleton from '@mui/material/Skeleton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import EventIcon from '@mui/icons-material/Event'
import ChecklistIcon from '@mui/icons-material/Checklist'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import DashboardCard from '../components/dashboard/DashboardCard.tsx'
import GigMapTile from '../components/dashboard/GigMapTile.tsx'
import { SOCIALS } from '../components/profile/profileForm.ts'
import { useAuth } from '../contexts/authContext.ts'
import { listGigs } from '../api/gigs.ts'
import { getNextRehearsal } from '../api/rehearsals.ts'
import { listAllTasks } from '../api/tasks.ts'
import { listBandEvents } from '../api/bandEvents.ts'
import { getProfile } from '../api/profile.ts'
import { formatShortDate } from '../utils/dateFormat.ts'
import { venueHeadline, venueCity } from '../utils/venueDisplay.ts'
import type { Gig, Rehearsal, BandEvent } from '../types/entities.ts'

function logoSrc(logoPath: string | undefined | null) {
  return logoPath ? `/api/files/${logoPath}` : '/share/logo.png'
}

const GIG_STATUS_COLOR: Record<string, 'success' | 'info' | 'default'> = {
  confirmed: 'success',
  announced: 'info',
  option: 'default',
}
const MAX_ROWS = 5

// DATE columns arrive as ISO strings or plain 'YYYY-MM-DD'; key by the first 10 chars.
const dateKey = (v: unknown) => (v ? String(v).slice(0, 10) : '')

function todayStr() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function byDateAscNullsLast(field: string) {
  return (a: Record<string, unknown>, b: Record<string, unknown>) => {
    const av = dateKey(a[field])
    const bv = dateKey(b[field])
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    if (av < bv) return -1
    if (av > bv) return 1
    return 0
  }
}

interface SettledResult<T> {
  status: 'ok' | 'error'
  data: T[]
}

const settle = <T,>(r: PromiseSettledResult<T[]>): SettledResult<T> =>
  r.status === 'fulfilled'
    ? { status: 'ok', data: r.value || [] }
    : { status: 'error', data: [] }

const settleOne = <T,>(r: PromiseSettledResult<T | null>): { status: 'ok' | 'error'; data: T | null } =>
  r.status === 'fulfilled'
    ? { status: 'ok', data: r.value ?? null }
    : { status: 'error', data: null }

interface Task {
  id?: number
  title?: string
  done?: boolean
  assigned_to?: number | null
  due_date?: string | null
  gig_id?: number
  event_description?: string
}

interface SectionData<T> {
  status: 'ok' | 'error'
  data: T[]
  total: number
}

interface Sections {
  nextGig: { status: 'ok' | 'error'; data: Gig | null }
  nextBandEvent: { status: 'ok' | 'error'; data: BandEvent | null }
  nextRehearsal: { status: 'ok' | 'error'; data: Rehearsal | null }
  shows: SectionData<Gig>
  tasks: SectionData<Task>
}

// Build the whole view-model in the effect (not in render) so render stays pure.
function buildSections(
  results: [PromiseSettledResult<Gig[]>, PromiseSettledResult<Rehearsal | null>, PromiseSettledResult<Task[]>, PromiseSettledResult<BandEvent[]>],
  bandMemberId: number | string | null | undefined,
): Sections {
  const [gigsR, rehR, taskR, bandEventsR] = results
  const today = todayStr()

  const gigsSettled = settle(gigsR)
  const upcomingGigs = [...gigsSettled.data]
    .filter((g) => dateKey(g.event_date) >= today)
    .sort(byDateAscNullsLast('event_date') as (a: Gig, b: Gig) => number)

  const rehSettled = settleOne(rehR)
  const taskSettled = settle(taskR)
  const bandEventsSettled = settle(bandEventsR)
  const upcomingBandEvents = [...bandEventsSettled.data]
    .filter((e) => dateKey(e.start_date) >= today)
    .sort(byDateAscNullsLast('start_date') as (a: BandEvent, b: BandEvent) => number)

  // Featured "next gig" is dropped from the shows list, so total excludes it too.
  const upcomingShows = upcomingGigs.slice(1)
  const myTasks = taskSettled.data
    .filter((t) => !t.done && bandMemberId != null && t.assigned_to === bandMemberId)
    .sort(byDateAscNullsLast('due_date') as (a: Task, b: Task) => number)

  return {
    nextGig: { status: gigsSettled.status, data: upcomingGigs[0] || null },
    nextBandEvent: { status: bandEventsSettled.status, data: upcomingBandEvents[0] || null },
    shows: { status: gigsSettled.status, total: upcomingShows.length, data: upcomingShows.slice(0, MAX_ROWS) },
    nextRehearsal: { status: rehSettled.status, data: rehSettled.data },
    tasks: {
      status: taskSettled.status,
      total: myTasks.length,
      data: myTasks.slice(0, MAX_ROWS),
    },
  }
}

interface RowProps {
  primary: ReactNode
  secondary?: ReactNode
  chip?: ReactNode
  onClick?: () => void
}

function Row({ primary, secondary, chip, onClick }: RowProps) {
  return (
    <ListItemButton onClick={onClick} disableGutters sx={{ borderRadius: 1, px: 1 }}>
      <ListItemText
        primary={primary}
        secondary={secondary}
        slotProps={{
          primary: { variant: 'body2', sx: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
          secondary: { variant: 'caption' },
        }}
      />
      {chip}
    </ListItemButton>
  )
}

interface ProfileData {
  logo_path?: string | null
  logo_dark_path?: string | null
  avatar_path?: string | null
  bandsintown_artist_name?: string
  [key: string]: unknown
}

export default function DashboardPage() {
  const { user } = useAuth()
  const bandMemberId = user?.bandMemberId ?? null
  const navigate = useNavigate()
  const theme = useTheme()
  const [loading, setLoading] = useState(true)
  const [sections, setSections] = useState<Sections | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getProfile()
      .then((data) => { if (!cancelled) { setProfile(data as ProfileData); setProfileLoading(false) } })
      .catch(() => { if (!cancelled) setProfileLoading(false) })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const results = await Promise.allSettled([
        listGigs(),
        getNextRehearsal(),
        listAllTasks() as Promise<Task[]>,
        listBandEvents(),
      ])
      setSections(buildSections(results as [PromiseSettledResult<Gig[]>, PromiseSettledResult<Rehearsal | null>, PromiseSettledResult<Task[]>, PromiseSettledResult<BandEvent[]>], bandMemberId))
    } finally {
      setLoading(false)
    }
  }, [bandMemberId])

  useEffect(() => { load() }, [load])

  if (loading || !sections) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  const { nextGig, nextBandEvent, nextRehearsal, shows, tasks } = sections
  const activeSocials = SOCIALS.filter(({ field, prefix }) => prefix && profile?.[field])

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        {profileLoading ? (
          <Skeleton variant="rectangular" width={80} height={40} sx={{ borderRadius: 1 }} />
        ) : (
          <Box
            component="img"
            src={logoSrc(theme.palette.mode === 'dark' && profile?.logo_dark_path ? profile.logo_dark_path : profile?.logo_path)}
            alt="Band logo"
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.src = '/share/logo.png' }}
            sx={{ maxHeight: 48, maxWidth: 120, objectFit: 'contain', display: 'block' }}
          />
        )}
        {activeSocials.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {activeSocials.map(({ field, label, Icon, prefix }) => (
              <Tooltip key={field} title={label}>
                <IconButton
                  component="a"
                  href={`https://${prefix}${profile![field as string]}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="small"
                  aria-label={label}
                >
                  {Icon && <Icon fontSize="small" />}
                </IconButton>
              </Tooltip>
            ))}
          </Box>
        )}
      </Box>

      <Grid container spacing={3} sx={{ alignItems: 'stretch' }}>
        {/* Next gig */}
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <DashboardCard
            title="Next gig"
            icon={EventIcon}
            viewAllTo={nextGig.data ? `/gigs/${nextGig.data.id}` : undefined}
            viewAllLabel="View details"
            status={nextGig.status}
            isEmpty={!nextGig.data}
            emptyText="No upcoming gigs"
            sx={{ height: 'auto', flexShrink: 0 }}
          >
            {nextGig.data && (
              <Box
                onClick={() => navigate(`/gigs/${nextGig.data!.id}`)}
                sx={{ cursor: 'pointer', py: 0.5, display: 'flex', alignItems: 'center', gap: 2 }}
              >
                <Box
                  sx={{
                    display: 'grid',
                    ml: 1,
                    gridTemplateColumns: 'auto 1fr',
                    columnGap: 3,
                    alignItems: 'baseline',
                    flexGrow: 1,
                    minWidth: 0,
                  }}
                >
                  <Typography variant="caption" sx={{ color: 'primary.main', textTransform: 'uppercase', textAlign: 'center' }}>
                    {new Date(nextGig.data.event_date!).toLocaleDateString('nl-NL', { month: 'short' })}
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>
                    {nextGig.data.event_description}
                  </Typography>
                  <Typography variant="h5" sx={{ color: 'text.primary', fontWeight: 700, textAlign: 'center' }}>
                    {new Date(nextGig.data.event_date!).getDate()}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 'light' }}>
                    {(() => {
                      const place = nextGig.data!.venue ?? nextGig.data!.festival
                      return [venueHeadline(place), venueCity(place)].filter(Boolean).join(', ')
                    })()}
                  </Typography>
                </Box>
                {nextGig.data.banner_path && (
                  <Box
                    component="img"
                    src={`/api/files/${nextGig.data.banner_path}`}
                    alt=""
                    sx={{
                      width: 56,
                      height: 56,
                      objectFit: 'cover',
                      borderRadius: 1,
                      flexShrink: 0,
                      display: 'block',
                    }}
                  />
                )}
              </Box>
            )}
          </DashboardCard>
        </Grid>
        {/* Next rehearsal */}
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <DashboardCard
            title="Next rehearsal"
            icon={MusicNoteIcon}
            viewAllTo={nextRehearsal.data ? `/rehearsals/${nextRehearsal.data.id}` : '/rehearsals'}
            viewAllLabel={nextRehearsal.data ? 'View details' : undefined}
            status={nextRehearsal.status}
            isEmpty={!nextRehearsal.data}
            emptyText="No planned rehearsals"
            sx={{ height: 'auto', flexShrink: 0 }}
          >
            {nextRehearsal.data && (
              <Box
                onClick={() => navigate(`/rehearsals/${nextRehearsal.data!.id}`)}
                sx={{ cursor: 'pointer', py: 0.5 }}
              >
                <Box
                  sx={{
                    display: 'grid',
                    ml: 1,
                    gridTemplateColumns: 'auto 1fr',
                    columnGap: 3,
                    alignItems: 'baseline',
                    minWidth: 0,
                  }}
                >
                  <Typography variant="caption" sx={{ color: 'primary.main', textTransform: 'uppercase', textAlign: 'center' }}>
                    {new Date(nextRehearsal.data.proposed_date!).toLocaleDateString('nl-NL', { month: 'short' })}
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {nextRehearsal.data.location || 'Rehearsal'}
                  </Typography>
                  <Typography variant="h5" sx={{ color: 'text.primary', fontWeight: 700, textAlign: 'center' }}>
                    {new Date(nextRehearsal.data.proposed_date!).getDate()}
                  </Typography>
                  {(nextRehearsal.data.start_time || nextRehearsal.data.end_time) && (
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 'light' }}>
                      {[nextRehearsal.data.start_time, nextRehearsal.data.end_time].filter(Boolean).map(t => t!.slice(0, 5)).join(' – ')}
                    </Typography>
                  )}
                </Box>
              </Box>
            )}
          </DashboardCard>
        </Grid>
        {/* Next band event */}
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <DashboardCard
            title="Next band event"
            icon={EventIcon}
            viewAllTo={nextBandEvent.data ? `/events/${nextBandEvent.data.id}` : undefined}
            viewAllLabel="View details"
            status={nextBandEvent.status}
            isEmpty={!nextBandEvent.data}
            emptyText="No upcoming band events"
            sx={{ height: 'auto', flexShrink: 0 }}
          >
            {nextBandEvent.data && (
              <Box
                onClick={() => navigate(`/events/${nextBandEvent.data!.id}`)}
                sx={{ cursor: 'pointer', py: 0.5, display: 'flex', alignItems: 'center', gap: 2 }}
              >
                <Box
                  sx={{
                    display: 'grid',
                    ml: 1,
                    gridTemplateColumns: 'auto 1fr',
                    columnGap: 3,
                    alignItems: 'baseline',
                    flexGrow: 1,
                    minWidth: 0,
                  }}
                >
                  <Typography variant="caption" sx={{ color: 'primary.main', textTransform: 'uppercase', textAlign: 'center' }}>
                    {new Date(nextBandEvent.data.start_date!).toLocaleDateString('nl-NL', { month: 'short' })}
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 700 }}>
                    {nextBandEvent.data.title}
                  </Typography>
                  <Typography variant="h5" sx={{ color: 'text.secondary', fontWeight: 700, textAlign: 'center' }}>
                    {new Date(nextBandEvent.data.start_date!).getDate()}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {nextBandEvent.data.location}
                  </Typography>
                </Box>
                {(() => {
                  const isDark = theme.palette.mode === 'dark'
                  if (profile?.avatar_path) {
                    return (
                      <Box
                        component="img"
                        src={`/api/files/${profile.avatar_path}`}
                        alt=""
                        sx={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                      />
                    )
                  }
                  const logoPath = isDark && profile?.logo_dark_path ? profile.logo_dark_path : profile?.logo_path
                  if (logoPath) {
                    return (
                      <Box
                        component="img"
                        src={`/api/files/${logoPath}`}
                        alt=""
                        sx={{ width: 44, height: 44, objectFit: 'contain', flexShrink: 0 }}
                      />
                    )
                  }
                  return null
                })()}
              </Box>
            )}
          </DashboardCard>
        </Grid>
        {/* Upcoming shows */}
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <DashboardCard
            title="Upcoming shows"
            icon={EventIcon}
            count={shows.total}
            viewAllTo="/gigs"
            status={shows.status}
            isEmpty={shows.data.length === 0}
            emptyText="No upcoming shows"
          >
            <List dense disablePadding>
              {shows.data.map((g, i) => {
                const place = g.venue ?? g.festival
                return (
                  <React.Fragment key={String(g.id)}>
                    {i > 0 && <Divider sx={{ width: '50%', mx: 'auto' }} />}
                    <ListItemButton
                      onClick={() => navigate(`/gigs/${g.id}`)}
                      disableGutters
                      sx={{ borderRadius: 1, px: 1 }}
                    >
                      <Box
                        sx={{
                          display: 'grid',
                          ml: 1,
                          gridTemplateColumns: '40px 1fr',
                          columnGap: 3,
                          alignItems: 'baseline',
                          flexGrow: 1,
                          minWidth: 0,
                        }}
                      >
                        <Typography variant="caption" sx={{ color: 'primary.main', textTransform: 'uppercase', textAlign: 'center' }}>
                          {new Date(g.event_date!).toLocaleDateString('nl-NL', { month: 'short' })}
                        </Typography>
                        <Typography variant="body1" sx={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {g.event_description}
                        </Typography>
                        <Typography variant="h5" sx={{ color: 'text.primary', fontWeight: 700, textAlign: 'center' }}>
                          {new Date(g.event_date!).getDate()}
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 'light' }}>
                          {[venueHeadline(place), venueCity(place)].filter(Boolean).join(', ')}
                        </Typography>
                      </Box>
                    </ListItemButton>
                  </React.Fragment>
                )
              })}
            </List>
          </DashboardCard>
        </Grid>
        {/* My tasks */}
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <DashboardCard
            title="My tasks"
            icon={ChecklistIcon}
            count={tasks.total}
            viewAllTo="/tasks"
            status={tasks.status}
            isEmpty={tasks.data.length === 0}
            emptyText="No open tasks"
          >
            <List dense disablePadding>
              {tasks.data.map((t) => (
                <Row
                  key={String(t.id)}
                  primary={t.title}
                  secondary={[t.event_description, t.due_date && formatShortDate(t.due_date)]
                    .filter(Boolean)
                    .join(' · ')}
                  onClick={() => navigate(`/gigs/${t.gig_id}`)}
                />
              ))}
            </List>
          </DashboardCard>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <GigMapTile />
          </Box>
        </Grid>

      </Grid>
    </Box>
  )
}
