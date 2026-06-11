import { useCallback, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
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
import DashboardCard from '../components/dashboard/DashboardCard.jsx'
import GigMapTile from '../components/dashboard/GigMapTile.jsx'
import { SOCIALS } from '../components/profile/profileForm.js'
import { useAuth } from '../contexts/authContext.js'
import { listGigs } from '../api/gigs.js'
import { listRehearsals } from '../api/rehearsals.js'
import { listAllTasks } from '../api/tasks.js'
import { getProfile } from '../api/profile.js'
import { formatShortDate } from '../utils/dateFormat.js'
import { venueHeadline, venueCity } from '../utils/venueDisplay.js'

function logoSrc(logoPath) {
  return logoPath ? `/api/files/${logoPath}` : '/share/logo.png'
}

const GIG_STATUS_COLOR = { confirmed: 'success', announced: 'info', option: 'default' }
const MAX_ROWS = 5

// DATE columns arrive as ISO strings or plain 'YYYY-MM-DD'; key by the first 10 chars.
const dateKey = (v) => (v ? String(v).slice(0, 10) : '')

function todayStr() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function byDateAscNullsLast(field) {
  return (a, b) => {
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

const settle = (r) =>
  r.status === 'fulfilled'
    ? { status: 'ok', data: r.value || [] }
    : { status: 'error', data: [] }

// Build the whole view-model in the effect (not in render) so render stays pure.
function buildSections(results) {
  const [gigsR, rehR, taskR, bandMemberId] = results
  const today = todayStr()

  const gigsSettled = settle(gigsR)
  const upcomingGigs = gigsSettled.data
    .filter((g) => dateKey(g.event_date) >= today)
    .sort(byDateAscNullsLast('event_date'))

  const rehSettled = settle(rehR)
  const taskSettled = settle(taskR)

  // Featured "next gig" is dropped from the shows list, so total excludes it too.
  const upcomingShows = upcomingGigs.slice(1)
  const upcomingRehearsals = rehSettled.data
    .filter((r) => dateKey(r.proposed_date) >= today)
    .sort(byDateAscNullsLast('proposed_date'))
  const myTasks = taskSettled.data
    .filter((t) => !t.done && bandMemberId != null && t.assigned_to === bandMemberId)
    .sort(byDateAscNullsLast('due_date'))

  return {
    nextGig: { status: gigsSettled.status, data: upcomingGigs[0] || null },
    shows: { status: gigsSettled.status, total: upcomingShows.length, data: upcomingShows.slice(0, MAX_ROWS) },
    rehearsals: {
      status: rehSettled.status,
      total: upcomingRehearsals.length,
      data: upcomingRehearsals.slice(0, MAX_ROWS),
    },
    tasks: {
      status: taskSettled.status,
      total: myTasks.length,
      data: myTasks.slice(0, MAX_ROWS),
    },
  }
}

function Row({ primary, secondary, chip, onClick }) {
  return (
    <ListItemButton onClick={onClick} disableGutters sx={{ borderRadius: 1, px: 1 }}>
      <ListItemText
        primary={primary}
        secondary={secondary}
        slotProps={{
          primary: { variant: 'body2', noWrap: true },
          secondary: { variant: 'caption' },
        }}
      />
      {chip}
    </ListItemButton>
  )
}

Row.propTypes = {
  primary: PropTypes.node.isRequired,
  secondary: PropTypes.node,
  chip: PropTypes.node,
  onClick: PropTypes.func,
}

export default function DashboardPage() {
  const { user } = useAuth()
  const bandMemberId = user?.bandMemberId ?? null
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [sections, setSections] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getProfile()
      .then((data) => { if (!cancelled) { setProfile(data); setProfileLoading(false) } })
      .catch(() => { if (!cancelled) setProfileLoading(false) })
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const results = await Promise.allSettled([
        listGigs(),
        listRehearsals(),
        listAllTasks(),
      ])
      setSections(buildSections([...results, bandMemberId]))
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

  const { nextGig, shows, rehearsals, tasks } = sections
  const activeSocials = SOCIALS.filter(({ field, prefix }) => prefix && profile?.[field])

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        {profileLoading ? (
          <Skeleton variant="rectangular" width={80} height={40} sx={{ borderRadius: 1 }} />
        ) : (
          <Box
            component="img"
            src={logoSrc(profile?.logo_path)}
            alt="Band logo"
            onError={(e) => { e.currentTarget.src = '/share/logo.png' }}
            sx={{ maxHeight: 48, maxWidth: 120, objectFit: 'contain', display: 'block' }}
          />
        )}
        {activeSocials.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {activeSocials.map(({ field, label, Icon, prefix }) => (
              <Tooltip key={field} title={label}>
                <IconButton
                  component="a"
                  href={`https://${prefix}${profile[field]}`}
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

        {/* Next gig + Played here stacked in one column */}
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, height: '100%' }}>
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
                  onClick={() => navigate(`/gigs/${nextGig.data.id}`)}
                  sx={{ cursor: 'pointer', py: 0.5, display: 'flex', alignItems: 'center', gap: 2 }}
                >
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="overline" color="text.secondary">
                      {formatShortDate(nextGig.data.event_date)}
                    </Typography>
                    <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
                      {nextGig.data.event_description}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2" color="text.secondary">
                        {(() => {
                          const place = nextGig.data.venue ?? nextGig.data.festival
                          return [venueHeadline(place), venueCity(place)].filter(Boolean).join(' · ')
                        })()}
                      </Typography>
                    </Box>
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
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <GigMapTile />
            </Box>
          </Box>
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
              {shows.data.map((g) => {
                const city = venueCity(g.venue ?? g.festival)
                const citySuffix = city ? ` · ${city}` : ''
                return (
                <Row
                  key={g.id}
                  primary={g.event_description}
                  secondary={`${formatShortDate(g.event_date)}${citySuffix}`}
                  chip={
                    <Chip
                      size="small"
                      label={g.status}
                      color={GIG_STATUS_COLOR[g.status] || 'default'}
                    />
                  }
                  onClick={() => navigate(`/gigs/${g.id}`)}
                />
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
                  key={t.id}
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

        {/* Rehearsals */}
        <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
          <DashboardCard
            title="Rehearsals"
            icon={MusicNoteIcon}
            viewAllTo="/rehearsals"
            status={rehearsals.status}
            isEmpty={rehearsals.data.length === 0}
            emptyText="No upcoming rehearsals"
          >
            <List dense disablePadding>
              {rehearsals.data.map((r) => (
                <Row
                  key={r.id}
                  primary={r.location || 'Rehearsal'}
                  secondary={formatShortDate(r.proposed_date)}
                  onClick={() => navigate(`/rehearsals/${r.id}`)}
                />
              ))}
            </List>
          </DashboardCard>
        </Grid>

      </Grid>
    </Box>
  )
}
