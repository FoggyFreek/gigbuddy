import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { alpha, useTheme } from '@mui/material/styles'
import Avatar from '@mui/material/Avatar'
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
import DashboardCard from './components/DashboardCard.tsx'
import MasonryLayout from '../../components/shared/MasonryLayout.tsx'
import CheersBadge from '../../user/achievements/components/CheersBadge.tsx'
import AchievementConfetti, { RECENT_WINDOW_MS } from '../../user/achievements/components/AchievementConfetti.tsx'
import { getAchievementIcon } from '../../user/achievements/components/achievementIcons.ts'
import GigMapTile from './components/GigMapTile.tsx'
import MemoryTile, { type MemoryPatch } from './components/MemoryTile.tsx'
import LinkpageStatsTile from './components/LinkpageStatsTile.tsx'
import { SOCIALS } from '../../people/profiles/components/profileForm.ts'
import { useEntitlements } from '../../hooks/useEntitlements.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { useCrossTenantNavigate } from '../../planning/shared/useCrossTenantNavigate.ts'
import { useTenantKind } from '../../hooks/useTenantKind.ts'
import { TENANT_CAPABILITIES } from '../../auth/tenantCapabilities.ts'
import { useSetWideContent } from '../../contexts/contentWidthContext.ts'
import { pickRandomBackground } from '../../utils/randomBackground.ts'
import { useThemeMode } from '../../contexts/themeModeContext.ts'
import type { ThemeMode } from '../../contexts/themeModeContext.ts'
import { listAchievements } from '../../user/achievements/achievements.ts'
import { getGig, listUpcomingGigs } from '../../planning/gigs/gigs.ts'
import { getNextRehearsal } from '../../planning/rehearsals/rehearsals.ts'
import { listTasks } from '../../planning/tasks/tasks.ts'
import { listUpcomingBandEvents } from '../../planning/events/bandEvents.ts'
import {
  getMyNextRehearsal,
  listMyTasks,
  listMyUpcomingBandEvents,
  listMyUpcomingGigs,
} from '../../planning/availability/me.ts'
import { getProfile } from '../../people/profiles/profile.ts'
import { daysUntil, formatDueDate, localDateString } from '../../utils/dateFormat.ts'
import { tenantAvatarUrl } from '../../utils/tenantAvatarUrl.ts'
import { venueHeadline, venueCity } from '../../people/venues/venueDisplay.ts'
import type { Achievement, Gig, Rehearsal, BandEvent, Id, Task } from '../../types/entities.ts'
import type {
  LimitedCollectionResponse,
  LimitedCollectionWithTotalResponse,
  MaybeCrossTenant,
} from '../../types/api.ts'

function logoSrc(logoPath: string | undefined | null) {
  return logoPath ? `/api/files/${logoPath}` : '/share/logo.png'
}

// Matches AppShell's CONTENT_MAX_WIDTH: the background bleeds edge-to-edge but
// the cards stay capped/centered at this width like every other page.
const CONTENT_MAX_WIDTH = 1400

const GIG_STATUS_COLOR: Record<string, 'success' | 'info' | 'default'> = {
  confirmed: 'success',
  announced: 'info',
  option: 'default',
}
const MAX_ROWS = 5

interface SettledResult<T> {
  status: 'ok' | 'error'
  data: T[]
}

const settle = <T,>(r: PromiseSettledResult<T[]>): SettledResult<T> =>
  r.status === 'fulfilled'
    ? { status: 'ok', data: r.value || [] }
    : { status: 'error', data: [] }

const settleCollection = <T,>(r: PromiseSettledResult<LimitedCollectionResponse<T>>): SettledResult<T> =>
  r.status === 'fulfilled'
    ? { status: 'ok', data: r.value.items }
    : { status: 'error', data: [] }

interface SectionData<T> {
  status: 'ok' | 'error'
  data: T[]
  total: number
}

// In an artist workspace every row can come from a different band, so each
// carries its own tenant label; in a band they are all the active tenant's.
type DashGig = MaybeCrossTenant<Gig>
type DashRehearsal = MaybeCrossTenant<Rehearsal>
type DashBandEvent = MaybeCrossTenant<BandEvent>

// Local view field: whole-day distance from today (negative = overdue), null when undated.
type DashTask = MaybeCrossTenant<Task> & { __daysUntil: number | null }

interface TasksSection {
  status: 'ok' | 'error'
  total: number
  overdue: DashTask[]
  upcoming: DashTask[]
}

interface Sections {
  nextGig: { status: 'ok' | 'error'; data: DashGig | null }
  nextBandEvent: { status: 'ok' | 'error'; data: DashBandEvent | null }
  nextRehearsal: { status: 'ok' | 'error'; data: DashRehearsal | null }
  shows: SectionData<DashGig>
  tasks: TasksSection
  achievements: SectionData<Achievement> & { latestUnlockedAt: string | null; recentKeys: string[] }
}

type DashboardResults = [
  PromiseSettledResult<LimitedCollectionWithTotalResponse<DashGig>>,
  PromiseSettledResult<DashRehearsal | null>,
  PromiseSettledResult<LimitedCollectionWithTotalResponse<MaybeCrossTenant<Task>>>,
  PromiseSettledResult<LimitedCollectionResponse<DashBandEvent>>,
  PromiseSettledResult<Achievement[]>,
]

// Build the whole view-model in the effect (not in render) so render stays pure.
function buildSections(results: DashboardResults): Sections {
  const [gigsR, rehR, taskR, bandEventsR, achievementsR] = results

  const gigsSettled = settleCollection(gigsR)
  const upcomingGigs = gigsSettled.data
  const taskSettled = settleCollection(taskR)
  const bandEventsSettled = settleCollection(bandEventsR)

  // Featured "next gig" is dropped from the shows list, so total excludes it too.
  const upcomingShows = upcomingGigs.slice(1)
  const visibleTasks: DashTask[] = taskSettled.data.map((t) => ({ ...t, __daysUntil: daysUntil(t.due_date) }))

  const achievementsSettled = settle(achievementsR)
  const unlockedAchievements = achievementsSettled.data
    .filter((a) => a.unlocked_at !== null)
    .sort((a, b) => String(b.unlocked_at).localeCompare(String(a.unlocked_at)))
  // Keys unlocked within the recency window at load time — highlighted with a
  // one-off entrance animation. Computed here (not in render) so render is pure.
  const nowMs = Date.now()
  const recentKeys = unlockedAchievements
    .filter((a) => {
      const age = nowMs - Date.parse(String(a.unlocked_at))
      return age >= 0 && age < RECENT_WINDOW_MS
    })
    .map((a) => a.key)

  return {
    nextGig: { status: gigsSettled.status, data: upcomingGigs[0] || null },
    nextBandEvent: { status: bandEventsSettled.status, data: bandEventsSettled.data[0] || null },
    shows: {
      status: gigsSettled.status,
      total: gigsR.status === 'fulfilled' ? Math.max(0, gigsR.value.meta.total - 1) : 0,
      data: upcomingShows,
    },
    nextRehearsal: {
      status: rehR.status === 'fulfilled' ? 'ok' : 'error',
      data: rehR.status === 'fulfilled' ? rehR.value : null,
    },
    tasks: {
      status: taskSettled.status,
      total: taskR.status === 'fulfilled' ? taskR.value.meta.total : 0,
      overdue: visibleTasks.filter((t) => t.__daysUntil != null && t.__daysUntil < 0),
      upcoming: visibleTasks.filter((t) => t.__daysUntil == null || t.__daysUntil >= 0),
    },
    achievements: {
      status: achievementsSettled.status,
      total: unlockedAchievements.length,
      data: unlockedAchievements.slice(0, 3),
      // Sorted unlocked-desc, so the head is the most recent unlock (if any).
      latestUnlockedAt: unlockedAchievements[0]?.unlocked_at ?? null,
      recentKeys,
    },
  }
}

interface ProfileData {
  logo_path?: string | null
  logo_dark_path?: string | null
  avatar_path?: string | null
  memory_image_path?: string | null
  memory_caption?: string | null
  memory_gig_id?: number | string | null
  bandsintown_artist_name?: string
  [key: string]: unknown
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation('dashboard')
  // Achievement titles live in their own namespace, keyed by achievement key.
  const { t: tAchievements } = useTranslation('achievements')
  const navigate = useNavigate()
  const theme = useTheme()
  const isCompact = useCompactLayout()
  const { has } = useEntitlements()
  const { canWritePlanning } = usePermissions()
  const { supports } = useTenantKind()
  const crossBand = supports(TENANT_CAPABILITIES.ARTIST_CALENDAR)
  const openInTenant = useCrossTenantNavigate()
  const [loading, setLoading] = useState(true)
  const [sections, setSections] = useState<Sections | null>(null)
  const [memoryGigs, setMemoryGigs] = useState<Gig[]>([])
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
      .then((data) => {
        if (cancelled) return
        const nextProfile = data as ProfileData
        setProfile(nextProfile)
        setProfileLoading(false)
        if (nextProfile.memory_gig_id != null) {
          getGig(nextProfile.memory_gig_id)
            .then((gig) => { if (!cancelled) setMemoryGigs([gig]) })
            .catch(() => {})
        }
      })
      .catch(() => { if (!cancelled) setProfileLoading(false) })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const today = localDateString()
      // Same five feeds either way — an artist workspace sources them from every
      // band the musician plays in instead of one active tenant. Achievements
      // stay tenant-local: the catalogue is a function of the tenant's kind.
      const results = await Promise.allSettled(crossBand ? [
        listMyUpcomingGigs(6, today),
        getMyNextRehearsal(),
        listMyTasks({ limit: MAX_ROWS, done: false }),
        listMyUpcomingBandEvents(1, today),
        listAchievements(),
      ] : [
        listUpcomingGigs(6, today),
        getNextRehearsal(),
        listTasks({ limit: MAX_ROWS, assignee: 'me', done: false }),
        listUpcomingBandEvents(1, today),
        listAchievements(),
      ])
      setSections(buildSections(results as DashboardResults))
    } finally {
      setLoading(false)
    }
  }, [crossBand])

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

  const openTask = (tenantId: Id | null | undefined, path: string) => {
    if (crossBand) {
      void openInTenant(tenantId, path)
      return
    }
    navigate(path)
  }

  // Aggregate event details have their own /api/me reads and stay inside the
  // artist workspace. Tasks intentionally switch because standalone tasks have
  // no detail route and gig tasks open the source band's editable task tab.
  const openRow = (_tenantId: Id | null | undefined, path: string) => navigate(path)

  // Which band a task came from. Event rows use the source avatar instead, while
  // tasks intentionally keep their existing text label.
  const bandName = (row: { tenantName?: string | null }) =>
    (crossBand ? row.tenantName : null) || null

  const renderSourceBandAvatar = (row: {
    tenantId?: Id
    tenantName?: string | null
    tenantAvatarPath?: string | null
  }) => {
    if (!crossBand) return null
    const name = row.tenantName?.trim() || ''
    return (
      <Tooltip title={name}>
        <Avatar
          src={tenantAvatarUrl(row.tenantId, row.tenantAvatarPath)}
          alt={name}
          sx={{ width: 32, height: 32, fontSize: '0.875rem', flexShrink: 0 }}
        >
          {name.charAt(0).toUpperCase() || '?'}
        </Avatar>
      </Tooltip>
    )
  }

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
              onClick={() => openTask(
                task.tenantId,
                task.gig_id ? `/gigs/${task.gig_id}?tab=tasks` : '/tasks',
              )}
              disableGutters
              sx={{ borderRadius: 1, px: 1, gap: 1, alignItems: 'baseline', ml: showTaskHeadings ? 1 : 0 }}
            >
              <ListItemText
                primary={task.title}
                secondary={[task.event_description, bandName(task)].filter(Boolean).join(' — ') || undefined}
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

  const handleMemorySaved = (patch: MemoryPatch) =>
    setProfile((prev) => (prev ? { ...prev, ...patch } : prev))

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

      <MasonryLayout columnWidth={360} spacing={isCompact ? 1.5 : 3}>
        {/* Next gig */}
        <Box>
          <DashboardCard
            title={t($ => $.nextGig.title)}
            icon={EventIcon}
            viewAllTo={nextGig.data ? `/gigs/${nextGig.data.id}` : undefined}
            onViewAll={crossBand && nextGig.data
              ? () => openRow(nextGig.data!.tenantId, `/gigs/${nextGig.data!.id}`)
              : undefined}
            viewAllLabel={t($ => $.card.viewDetails)}
            status={nextGig.status}
            isEmpty={!nextGig.data}
            emptyText={t($ => $.nextGig.empty)}
            sx={{ height: 'auto', flexShrink: 0 }}
          >
            {nextGig.data && (
              <Box
                onClick={() => openRow(nextGig.data!.tenantId, `/gigs/${nextGig.data!.id}`)}
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
                {renderSourceBandAvatar(nextGig.data)}
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
            onViewAll={crossBand && nextRehearsal.data
              ? () => openRow(nextRehearsal.data!.tenantId, `/rehearsals/${nextRehearsal.data!.id}`)
              : undefined}
            viewAllLabel={nextRehearsal.data ? t($ => $.card.viewDetails) : undefined}
            status={nextRehearsal.status}
            isEmpty={!nextRehearsal.data}
            emptyText={t($ => $.nextRehearsal.empty)}
            sx={{ height: 'auto', flexShrink: 0 }}
          >
            {nextRehearsal.data && (
              <Box
                onClick={() => openRow(nextRehearsal.data!.tenantId, `/rehearsals/${nextRehearsal.data!.id}`)}
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
                {renderSourceBandAvatar(nextRehearsal.data)}
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
            onViewAll={crossBand && nextBandEvent.data
              ? () => openRow(nextBandEvent.data!.tenantId, `/events/${nextBandEvent.data!.id}`)
              : undefined}
            viewAllLabel={t($ => $.card.viewDetails)}
            status={nextBandEvent.status}
            isEmpty={!nextBandEvent.data}
            emptyText={t($ => $.nextBandEvent.empty)}
            sx={{ height: 'auto', flexShrink: 0 }}
          >
            {nextBandEvent.data && (
              <Box
                onClick={() => openRow(nextBandEvent.data!.tenantId, `/events/${nextBandEvent.data!.id}`)}
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
                {crossBand ? renderSourceBandAvatar(nextBandEvent.data) : (() => {
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
                      onClick={() => openRow(g.tenantId, `/gigs/${g.id}`)}
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
                      {renderSourceBandAvatar(g)}
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
        {/* Link page statistics — a band surface, on plans that include it. The
            tile hides itself when the link page app isn't configured. */}
        {supports(TENANT_CAPABILITIES.BAND_LINKPAGE) && has('linkpage') && (
          <Box>
            <LinkpageStatsTile />
          </Box>
        )}
        {/* Band memory tile — celebratory photo (customization feature). */}
        {has('customization') && (
          <Box>
            <MemoryTile
              imagePath={profile?.memory_image_path ?? null}
              caption={profile?.memory_caption ?? null}
              gigId={profile?.memory_gig_id ?? null}
              gigs={memoryGigs}
              canEdit={canWritePlanning}
              onSaved={handleMemorySaved}
            />
          </Box>
        )}
        {/* Recently unlocked achievements */}
        <Box sx={{ position: 'relative' }}>
          <AchievementConfetti
            recentUnlockAt={achievements.latestUnlockedAt}
            announcement={t($ => $.achievements.newlyUnlocked)}
          />
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
                const isNew = achievements.recentKeys.includes(a.key)
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
                        // A newly unlocked row gently pulses its border/background
                        // from a primary highlight back to the resting colours.
                        ...(isNew && {
                          '@keyframes achievementUnlockPulse': {
                            '0%, 100%': {
                              borderColor: theme.palette.divider,
                              backgroundColor: theme.palette.background.paper,
                            },
                            '35%': {
                              borderColor: theme.palette.primary.main,
                              backgroundColor: alpha(theme.palette.primary.main, 0.12),
                            },
                          },
                          animation: 'achievementUnlockPulse 2s ease-in-out 2',
                          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                        }),
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

      </MasonryLayout>
      </Box>
    </Box>
  )
}
