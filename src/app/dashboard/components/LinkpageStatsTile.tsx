import { Suspense, lazy, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Skeleton from '@mui/material/Skeleton'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import EditIcon from '@mui/icons-material/Edit'
import InsightsIcon from '@mui/icons-material/Insights'
import DashboardCard from './DashboardCard.tsx'
import {
  LINKPAGE_STATS_WINDOWS,
  getLinkpageStats,
  listLinkpagePages,
} from '../../../promotion/linkpage/linkpage.ts'
import type { LinkpagePage, LinkpageStats, LinkpageStatsWindow } from '../../../promotion/linkpage/linkpage.ts'
import { useOpenLinkpageEditor } from '../../../promotion/linkpage/useOpenLinkpageEditor.ts'
import type { ApiError } from '../../../types/api.ts'

const LinkpageStatsChart = lazy(() => import('./LinkpageStatsChart.tsx'))

const CHART_SKELETON_HEIGHT = 230

// Nothing to show rather than something to fix: the integration isn't wired up
// on this server (503), or this tenant may not use it at all (403). The tile
// disappears instead of reporting a failure the member can't act on.
const HIDDEN_STATUSES = new Set([403, 503])

// Four-digit counts still fit a quarter of a dashboard tile; beyond that,
// compact notation keeps the row on one line.
const COMPACT_FROM = 10_000

interface Props {
  /** Overrides the default window; the tile keeps its own state after that. */
  defaultDays?: LinkpageStatsWindow
}

interface LoadedStats {
  days: LinkpageStatsWindow
  pageId: number | null
  status: 'ok' | 'error'
  stats: LinkpageStats | null
}

// A release page is named by its release; the main page (and a release without
// a title) falls back to the slug's own last segment.
function pageLabel(page: LinkpagePage) {
  return page.title?.trim() || page.slug.split('/').pop() || page.slug
}

interface StatTileProps {
  label: string
  value: string
}

function StatTile({ label, value }: Readonly<StatTileProps>) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.2 }}>{value}</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.2, display: 'block' }}>
        {label}
      </Typography>
    </Box>
  )
}

/**
 * Visit statistics for the band's link page, read live from the decoupled link
 * page app — a headline row plus the daily views/clicks breakdown. Rendered
 * only for tenants that may have a link page; the tile hides itself when the
 * integration isn't configured on this server.
 */
export default function LinkpageStatsTile({ defaultDays = 30 }: Readonly<Props>) {
  const { t, i18n } = useTranslation('dashboard')
  const [days, setDays] = useState<LinkpageStatsWindow>(defaultDays)
  // The window each result was fetched for, so "still loading" is derived from
  // what has arrived rather than tracked in its own state.
  const [result, setResult] = useState<LoadedStats | null>(null)
  // null = whichever page the link page app considers the tenant's main one.
  const [pageId, setPageId] = useState<number | null>(null)
  const [pages, setPages] = useState<LinkpagePage[]>([])
  const [editing, setEditing] = useState(false)
  const [hidden, setHidden] = useState(false)
  const { open, opening } = useOpenLinkpageEditor(t($ => $.linkpage.openError))

  // The page list only decides whether a picker is worth showing, so a failure
  // here leaves the tile on the main page rather than breaking it.
  useEffect(() => {
    let cancelled = false
    listLinkpagePages()
      .then((data) => { if (!cancelled) setPages(data.pages) })
      .catch(() => { /* no picker */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    getLinkpageStats(days, pageId)
      .then((stats) => {
        if (!cancelled) setResult({ days, pageId, status: 'ok', stats })
      })
      .catch((err: ApiError) => {
        if (cancelled) return
        if (HIDDEN_STATUSES.has(err.status)) setHidden(true)
        // A selection the link page app no longer knows (page deleted in the
        // editor since the list was read) falls back to the main page.
        else if (err.status === 404 && pageId !== null) setPageId(null)
        else setResult({ days, pageId, status: 'error', stats: null })
      })
    return () => { cancelled = true }
  }, [days, pageId])

  if (hidden) return null

  const stats = result?.stats ?? null
  const status = result?.status ?? 'ok'
  // The previous window's numbers stay on screen while the next arrive, dimmed
  // — a switch shouldn't blank the tile it was meant to refine.
  const refetching = result !== null && (result.days !== days || result.pageId !== pageId)

  const locale = i18n.resolvedLanguage ?? 'en'
  const formatCount = (value: number) =>
    new Intl.NumberFormat(locale, value >= COMPACT_FROM ? { notation: 'compact', maximumFractionDigits: 1 } : {})
      .format(value)
  const formatPercent = (value: number | null) =>
    value === null ? '—' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100)

  const summary = stats?.hasPage ? stats : null
  const tiles = [
    { label: t($ => $.linkpage.stat.views), value: formatCount(summary?.totalViews ?? 0) },
    { label: t($ => $.linkpage.stat.uniqueVisitors), value: formatCount(summary?.uniqueVisits ?? 0) },
    { label: t($ => $.linkpage.stat.clicks), value: formatCount(summary?.totalClicks ?? 0) },
    { label: t($ => $.linkpage.stat.ctr), value: formatPercent(summary?.clickThroughRate ?? null) },
  ]

  const rangeToggle = (
    <ToggleButtonGroup
      value={days}
      exclusive
      size="small"
      aria-label={t($ => $.linkpage.range.label)}
      onChange={(_event, value: LinkpageStatsWindow | null) => value && setDays(value)}
    >
      {LINKPAGE_STATS_WINDOWS.map((range) => (
        <ToggleButton key={range} value={range} sx={{ px: 1, py: 0.25, fontSize: '0.7rem' }}>
          {t($ => $.linkpage.range.days, { count: range })}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )

  // Which page the tile reports on is the only thing there is to configure, so
  // a band with a single page gets no edit affordance at all.
  const canConfigure = pages.length > 1
  const mainPageId = pages.find((page) => page.pageType === 'main')?.id ?? pages[0]?.id

  const editAction = canConfigure ? (
    <Tooltip title={editing ? t($ => $.linkpage.done) : t($ => $.linkpage.configure)}>
      <IconButton
        size="small"
        onClick={() => setEditing((prev) => !prev)}
        color={editing ? 'primary' : 'default'}
        aria-label={editing ? t($ => $.linkpage.done) : t($ => $.linkpage.configure)}
      >
        {editing ? <CheckIcon fontSize="small" /> : <EditIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  ) : undefined

  // Above the body — and outside its loading/error/empty states — so it reads
  // as the tile's setting rather than part of the report, and so a page whose
  // statistics failed can still be switched away from.
  const picker = canConfigure && editing && (
    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
      <TextField
        select
        size="small"
        label={t($ => $.linkpage.pageLabel)}
        value={pageId ?? mainPageId}
        onChange={(event) => setPageId(Number(event.target.value))}
        sx={{ minWidth: 200, maxWidth: '100%' }}
      >
        {pages.map((page) => (
          <MenuItem key={page.id} value={page.id}>{pageLabel(page)}</MenuItem>
        ))}
      </TextField>
    </Box>
  )

  let body
  if (result === null) {
    body = <Skeleton variant="rounded" height={CHART_SKELETON_HEIGHT + 56} />
  } else if (status === 'error') {
    body = (
      <Typography variant="body2" sx={{ py: 2, color: 'error.main' }}>
        {t($ => $.card.loadError)}
      </Typography>
    )
  } else if (!summary) {
    body = (
      <Typography variant="body2" sx={{ py: 2, color: 'text.secondary' }}>
        {t($ => $.linkpage.noPage)}
      </Typography>
    )
  } else {
    body = (
      <Box sx={{ opacity: refetching ? 0.6 : 1, transition: 'opacity 150ms' }}>
        {!summary.enabled && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            {t($ => $.linkpage.collectionDisabled)}
          </Typography>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1, mb: 2 }}>
          {tiles.map((tile) => <StatTile key={tile.label} label={tile.label} value={tile.value} />)}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 0 }}>
            {t($ => $.linkpage.chartTitle)}
          </Typography>
          {rangeToggle}
        </Box>

        {summary.byDay.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 3 }}>
            {t($ => $.linkpage.chartEmpty)}
          </Typography>
        ) : (
          <Suspense fallback={<Skeleton variant="rounded" height={CHART_SKELETON_HEIGHT} />}>
            <LinkpageStatsChart byDay={summary.byDay} />
          </Suspense>
        )}
      </Box>
    )
  }

  return (
    <DashboardCard
      title={t($ => $.linkpage.title)}
      icon={InsightsIcon}
      action={editAction}
      onViewAll={open}
      viewAllLabel={t($ => $.linkpage.edit)}
      sx={{ opacity: opening ? 0.7 : 1 }}
    >
      {picker}
      {body}
    </DashboardCard>
  )
}
