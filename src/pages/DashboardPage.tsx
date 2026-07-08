import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { alpha, useTheme } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListSubheader from '@mui/material/ListSubheader'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Skeleton from '@mui/material/Skeleton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import EventIcon from '@mui/icons-material/Event'
import ChecklistIcon from '@mui/icons-material/Checklist'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import DashboardCard from '../components/dashboard/DashboardCard.tsx'
import CheersBadge from '../components/achievements/CheersBadge.tsx'
import { getAchievementIcon } from '../components/achievements/achievementIcons.ts'
import GigMapTile from '../components/dashboard/GigMapTile.tsx'
import { SOCIALS } from '../components/profile/profileForm.ts'
import { useAuth } from '../contexts/authContext.ts'
import { useSetWideContent } from '../contexts/contentWidthContext.ts'
import { useThemeMode } from '../contexts/themeModeContext.ts'
import type { ThemeMode } from '../contexts/themeModeContext.ts'
import { listAchievements } from '../api/achievements.ts'
import { listGigs } from '../api/gigs.ts'
import { getNextRehearsal } from '../api/rehearsals.ts'
import { listAllTasks } from '../api/tasks.ts'
import { listBandEvents } from '../api/bandEvents.ts'
import { getProfile } from '../api/profile.ts'
import { daysUntil, formatDueDate } from '../utils/dateFormat.ts'
import { venueHeadline, venueCity } from '../utils/venueDisplay.ts'
import type { Achievement, Gig, Rehearsal, BandEvent, Task } from '../types/entities.ts'

function logoSrc(logoPath: string | undefined | null) {
  return logoPath ? `/api/files/${logoPath}` : '/share/logo.png'
}

// Background images live in /public/backgrounds as bg_NN_<mode>.jpg, with a
// separate set per theme mode. Bump the matching count when you add files.
const BACKGROUND_COUNTS: Record<ThemeMode, number> = { light: 5, dark: 5 }

// Matches AppShell's CONTENT_MAX_WIDTH: the background bleeds edge-to-edge but
// the cards stay capped/centered at this width like every other page.
const CONTENT_MAX_WIDTH = 1400

// Pick a random background image (for the active theme mode) plus a random crop
// position. `cover` scaling already adapts to the viewport (compact vs.
// desktop); randomizing backgroundPosition picks a different slice when the
// image overflows.
function pickRandomBackground(mode: ThemeMode) {
  const n = Math.floor(Math.random() * BACKGROUND_COUNTS[mode]) + 1
  const x = Math.floor(Math.random() * 101)
  const y = Math.floor(Math.random() * 101)
  return {
    image: `url(/backgrounds/bg_${String(n).padStart(2, '0')}_${mode}.jpg)`,
    position: `${x}% ${y}%`,
  }
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

interface SectionData<T> {
  status: 'ok' | 'error'
  data: T[]
  total: number
}

// Local view field: whole-day distance from today (negative = overdue), null when undated.
type DashTask = Task & { __daysUntil: number | null }

interface TasksSection {
  status: 'ok' | 'error'
  total: number
  overdue: DashTask[]
  upcoming: DashTask[]
}

interface Sections {
  nextGig: { status: 'ok' | 'error'; data: Gig | null }
  nextBandEvent: { status: 'ok' | 'error'; data: BandEvent | null }
  nextRehearsal: { status: 'ok' | 'error'; data: Rehearsal | null }
  shows: SectionData<Gig>
  tasks: TasksSection
  achievements: SectionData<Achievement>
}

// Build the whole view-model in the effect (not in render) so render stays pure.
function buildSections(
  results: [PromiseSettledResult<Gig[]>, PromiseSettledResult<Rehearsal | null>, PromiseSettledResult<Task[]>, PromiseSettledResult<BandEvent[]>, PromiseSettledResult<Achievement[]>],
  bandMemberId: number | string | null | undefined,
): Sections {
  const [gigsR, rehR, taskR, bandEventsR, achievementsR] = results
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
  const myTasks: DashTask[] = taskSettled.data
    .filter((t) => !t.done && bandMemberId != null && t.assigned_to === bandMemberId)
    .sort(byDateAscNullsLast('due_date') as (a: Task, b: Task) => number)
    .map((t) => ({ ...t, __daysUntil: daysUntil(t.due_date) }))
  // Sorted ascending (nulls last), so overdue rows come first and survive the cap.
  const visibleTasks = myTasks.slice(0, MAX_ROWS)

  const achievementsSettled = settle(achievementsR)
  const unlockedAchievements = achievementsSettled.data
    .filter((a) => a.unlocked_at !== null)
    .sort((a, b) => String(b.unlocked_at).localeCompare(String(a.unlocked_at)))

  return {
    nextGig: { status: gigsSettled.status, data: upcomingGigs[0] || null },
    nextBandEvent: { status: bandEventsSettled.status, data: upcomingBandEvents[0] || null },
    shows: { status: gigsSettled.status, total: upcomingShows.length, data: upcomingShows.slice(0, MAX_ROWS) },
    nextRehearsal: { status: rehSettled.status, data: rehSettled.data },
    tasks: {
      status: taskSettled.status,
      total: myTasks.length,
      overdue: visibleTasks.filter((t) => t.__daysUntil != null && t.__daysUntil < 0),
      upcoming: visibleTasks.filter((t) => t.__daysUntil == null || t.__daysUntil >= 0),
    },
    achievements: {
      status: achievementsSettled.status,
      total: unlockedAchievements.length,
      data: unlockedAchievements.slice(0, 3),
    },
  }
}

interface ProfileData {
  logo_path?: string | null
  logo_dark_path?: string | null
  avatar_path?: string | null
  bandsintown_artist_name?: string
  [key: string]: unknown
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation('dashboard')
  // Achievement titles live in their own namespace, keyed by achievement key.
  const { t: tAchievements } = useTranslation('achievements')
  const { user } = useAuth()
  const bandMemberId = user?.bandMemberId ?? null
  const navigate = useNavigate()
  const theme = useTheme()
  const [loading, setLoading] = useState(true)
  const [sections, setSections] = useState<Sections | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  // Chosen once per mount so it stays stable across re-renders, then re-picked
  // (from the matching light/dark set) only when the theme mode actually flips.
  const { mode } = useThemeMode()
  const [background, setBackground] = useState(() => pickRandomBackground(mode))
  const prevMode = useRef<ThemeMode>(mode)
  useEffect(() => {
    if (prevMode.current !== mode) {
      prevMode.current = mode
      setBackground(pickRandomBackground(mode))
    }
  }, [mode])
  const setWideContent = useSetWideContent()

  // Let the dashboard use the full viewport width, then bleed past the <main>
  // padding (p:3 in AppShell) with negative margins so the background image
  // stretches edge-to-edge instead of being boxed inside the content column.
  useEffect(() => {
    setWideContent(true)
    return () => setWideContent(false)
  }, [setWideContent])

  const backgroundSx = {
    backgroundImage: background.image,
    backgroundSize: 'cover',
    backgroundPosition: background.position,
    backgroundRepeat: 'no-repeat',
    m: -3,
    minHeight: 'calc(100vh - 64px)',
  } as const

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
        listAchievements(),
      ])
      setSections(buildSections(results as [PromiseSettledResult<Gig[]>, PromiseSettledResult<Rehearsal | null>, PromiseSettledResult<Task[]>, PromiseSettledResult<BandEvent[]>, PromiseSettledResult<Achievement[]>], bandMemberId))
    } finally {
      setLoading(false)
    }
  }, [bandMemberId])

  useEffect(() => { load() }, [load])

  if (loading || !sections) {
    return (
      <Box sx={{ ...backgroundSx, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  const { nextGig, nextBandEvent, nextRehearsal, shows, tasks, achievements } = sections
  const activeSocials = SOCIALS.filter(({ field, prefix }) => prefix && profile?.[field])

  // Shared with the tasks page: today / tomorrow / "in N days" within the coming
  // week, else an absolute short date (also the label for overdue rows, which
  // carry a past date).
  const locale = i18n.resolvedLanguage ?? 'en'
  const dueLabel = (task: DashTask): string =>
    task.due_date ? formatDueDate(task.due_date, locale) : ''

  // Headers only earn their place when both groups are present; a single-group
  // list (all overdue or all upcoming) is self-explanatory, so drop the heading.
  const showTaskHeadings = tasks.overdue.length > 0 && tasks.upcoming.length > 0
  const renderTaskGroup = (heading: string, items: DashTask[]) => {
    if (items.length === 0) return null
    return (
      <React.Fragment key={heading}>
        {showTaskHeadings && (
          <ListSubheader
            disableGutters
            disableSticky
            sx={{ px: 1, lineHeight: 2.2, bgcolor: 'transparent', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: '0.7rem' }}
          >
            {heading}
          </ListSubheader>
        )}
        {items.map((task) => {
          const label = dueLabel(task)
          const overdue = task.__daysUntil != null && task.__daysUntil < 0
          return (
            <ListItemButton
              key={String(task.id)}
              onClick={() => navigate(task.gig_id ? `/gigs/${task.gig_id}?tab=tasks` : '/tasks')}
              disableGutters
              sx={{ borderRadius: 1, px: 1, gap: 1, alignItems: 'baseline' }}
            >
              <ListItemText
                primary={task.title}
                secondary={task.event_description || undefined}
                slotProps={{
                  primary: { variant: 'body2', sx: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                  secondary: { variant: 'caption' },
                }}
                sx={{ my: 0, minWidth: 0 }}
              />
              {label && (
                <Typography
                  variant="subtitle2"
                  sx={{ flexShrink: 0, whiteSpace: 'nowrap', color: overdue ? 'error.main' : 'text.secondary' }}
                >
                  {label}
                </Typography>
              )}
            </ListItemButton>
          )
        })}
      </React.Fragment>
    )
  }

  return (
    <Box sx={{ ...backgroundSx, p: 3, position: 'relative' }}>
      {/* Theme-aware fade: the background image dissolves into the page colour
          across the top 100px (20% transparent → fully transparent). */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 500,
          pointerEvents: 'none',
          background: `linear-gradient(to bottom, ${alpha(theme.palette.background.default, 1)}, ${alpha(theme.palette.background.default, 0)})`,
        }}
      />
      <Box sx={{ maxWidth: CONTENT_MAX_WIDTH, mx: 'auto', position: 'relative' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        {profileLoading ? (
          <Skeleton variant="rectangular" width={80} height={40} sx={{ borderRadius: 1 }} />
        ) : (
          <Box
            component="img"
            src={logoSrc(theme.palette.mode === 'dark' && profile?.logo_dark_path ? profile.logo_dark_path : profile?.logo_path)}
            alt={t($ => $.bandLogoAlt)}
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

      <Box
        sx={{
          // Masonry: cards flow down each column slot, packing shorter cards
          // together instead of leaving gaps under a row's tallest card
          // (matches the tasks page layout in TasksTable).
          columnWidth: 360,
          columnGap: 3,
          '& > *': { breakInside: 'avoid', mb: 3 },
        }}
      >
        {/* Next gig */}
        <Box>
          <DashboardCard
            title={t($ => $.nextGig.title)}
            icon={EventIcon}
            viewAllTo={nextGig.data ? `/gigs/${nextGig.data.id}` : undefined}
            viewAllLabel={t($ => $.card.viewDetails)}
            status={nextGig.status}
            isEmpty={!nextGig.data}
            emptyText={t($ => $.nextGig.empty)}
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
        </Box>
        {/* Next rehearsal */}
        <Box>
          <DashboardCard
            title={t($ => $.nextRehearsal.title)}
            icon={MusicNoteIcon}
            viewAllTo={nextRehearsal.data ? `/rehearsals/${nextRehearsal.data.id}` : '/rehearsals'}
            viewAllLabel={nextRehearsal.data ? t($ => $.card.viewDetails) : undefined}
            status={nextRehearsal.status}
            isEmpty={!nextRehearsal.data}
            emptyText={t($ => $.nextRehearsal.empty)}
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
                    {nextRehearsal.data.location || t($ => $.nextRehearsal.fallbackLocation)}
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
        </Box>
        {/* Next band event */}
        <Box>
          <DashboardCard
            title={t($ => $.nextBandEvent.title)}
            icon={EventIcon}
            viewAllTo={nextBandEvent.data ? `/events/${nextBandEvent.data.id}` : undefined}
            viewAllLabel={t($ => $.card.viewDetails)}
            status={nextBandEvent.status}
            isEmpty={!nextBandEvent.data}
            emptyText={t($ => $.nextBandEvent.empty)}
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
        </Box>
        {/* Upcoming shows */}
        <Box>
          <DashboardCard
            title={t($ => $.upcomingShows.title)}
            icon={EventIcon}
            count={shows.total}
            viewAllTo="/gigs"
            status={shows.status}
            isEmpty={shows.data.length === 0}
            emptyText={t($ => $.upcomingShows.empty)}
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
        </Box>
        {/* My tasks */}
        <Box>
          <DashboardCard
            title={t($ => $.myTasks.title)}
            icon={ChecklistIcon}
            count={tasks.total}
            viewAllTo="/tasks"
            status={tasks.status}
            isEmpty={tasks.overdue.length === 0 && tasks.upcoming.length === 0}
            emptyText={t($ => $.myTasks.empty)}
          >
            <List dense disablePadding>
              {renderTaskGroup(t($ => $.myTasks.overdue), tasks.overdue)}
              {renderTaskGroup(t($ => $.myTasks.upcoming), tasks.upcoming)}
            </List>
          </DashboardCard>
        </Box>
        <Box>
          <GigMapTile />
        </Box>
        {/* Recently unlocked achievements */}
        <Box>
          <DashboardCard
            title={t($ => $.achievements.title)}
            icon={EmojiEventsIcon}
            count={achievements.total}
            viewAllTo="/achievements"
            viewAllLabel={t($ => $.achievements.showAll)}
            status={achievements.status}
            isEmpty={achievements.data.length === 0}
            emptyText={t($ => $.achievements.empty)}
          >
            <List dense disablePadding sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {achievements.data.map((a) => {
                const Icon = getAchievementIcon(a.key, a.category)
                return (
                  <Tooltip key={a.key} title={tAchievements($ => $.items[a.key].description)} arrow>
                    <ListItemButton
                      onClick={() => navigate('/achievements')}
                      disableGutters
                      sx={{
                        borderRadius: '20px',
                        px: 1.25,
                        py: 1,
                        gap: 1.5,
                        alignItems: 'center',
                        bgcolor: 'background.paper',
                        border: 1,
                        borderColor: 'divider',
                        transition: 'box-shadow 120ms ease, transform 120ms ease',
                        '&:hover': { boxShadow: 3, transform: 'translateY(-1px)' },
                      }}
                    >
                      <Icon fontSize="small" sx={{ color: 'primary.main', flexShrink: 0 }} />
                      <ListItemText
                        primary={tAchievements($ => $.items[a.key].title)}
                        secondary={tAchievements($ => $.unlockedOn, { date: new Date(a.unlocked_at!).toLocaleDateString(i18n.resolvedLanguage ?? 'en') })}
                        slotProps={{
                          primary: { variant: 'body2', sx: { fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                          secondary: { variant: 'caption' },
                        }}
                        sx={{ my: 0, minWidth: 0 }}
                      />
                      <CheersBadge cheers={a.cheers} size={28} />
                    </ListItemButton>
                  </Tooltip>
                )
              })}
            </List>
          </DashboardCard>
        </Box>

      </Box>
      </Box>
    </Box>
  )
}
