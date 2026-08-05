import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useAuth } from '../contexts/authContext.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { formatEur } from '../utils/invoiceTotals.ts'
import { toIsoDate } from '../utils/availabilityUtils.ts'
import MoneyCells, { MoneyHeaderCells } from '../components/shared/MoneyCells.tsx'
import { monthWindow, shiftMonth, yearWindow } from '../utils/monthWindow.ts'
import {
  listMyAgenda,
  listMyPastAgenda,
  listMyEarnings,
  type AgendaItem,
  type EarningsRow,
} from '../api/me.ts'
import type { ListCollectionCursor } from '../types/api.ts'

const PAST_PAGE_SIZE = 20

// Where an agenda item lives inside its own tenant.
const ITEM_PATH: Record<AgendaItem['type'], string> = {
  gig: '/gigs',
  rehearsal: '/rehearsals',
  band_event: '/events',
}

// The cross-tenant hub: one agenda and one earnings view across every band the
// musician plays in. Read-only — the hub never writes, and every row links into
// its own tenant, switching the active tenant on the way.
export default function MyHubPage() {
  const { t, i18n } = useTranslation('dashboard')
  const navigate = useNavigate()
  const { switchTenant } = useAuth()
  const isCompact = useCompactLayout()

  const today = useMemo(() => new Date(), [])
  const [view, setView] = useState<'month' | 'past'>('month')
  const [{ year, month }, setCursorMonth] = useState({
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  })

  const [agenda, setAgenda] = useState<AgendaItem[]>([])
  const [past, setPast] = useState<AgendaItem[]>([])
  const [pastCursor, setPastCursor] = useState<ListCollectionCursor | null>(null)
  const [pastLoaded, setPastLoaded] = useState(false)
  const [earnings, setEarnings] = useState<EarningsRow[]>([])
  const [failed, setFailed] = useState(false)

  const window = useMemo(() => monthWindow(year, month), [year, month])

  useEffect(() => {
    let cancelled = false
    listMyAgenda(window)
      .then((res) => { if (!cancelled) setAgenda(res.items) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [window])

  useEffect(() => {
    let cancelled = false
    listMyEarnings(yearWindow(today.getFullYear()))
      .then((res) => { if (!cancelled) setEarnings(res.items) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [today])

  // The past feed's cutoff is the user's LOCAL calendar day, not the server's.
  const todayIso = useMemo(() => toIsoDate(today), [today])

  // Keyset paging: each page continues from the previous page's last
  // (date, id); a null cursor means the feed is exhausted.
  const loadPast = useCallback(async (cursor: ListCollectionCursor | null) => {
    try {
      const res = await listMyPastAgenda({ today: todayIso, limit: PAST_PAGE_SIZE, cursor })
      setPast((prev) => (cursor ? [...prev, ...res.items] : res.items))
      setPastCursor(res.meta.nextCursor)
      setPastLoaded(true)
    } catch {
      setFailed(true)
    }
  }, [todayIso])

  function showPast() {
    setView('past')
    if (!pastLoaded) void loadPast(null)
  }

  // Every row links into its own tenant, so the switch happens first.
  async function openItem(item: AgendaItem) {
    try {
      await switchTenant(item.tenantId)
    } catch {
      return // failure leaves the user where they are
    }
    navigate(`${ITEM_PATH[item.type]}/${item.id}`)
  }

  const itemRow = (item: AgendaItem) => (
    <ListItemButton key={`${item.type}-${item.id}`} onClick={() => { void openItem(item) }}>
      <ListItemText
        primary={item.title || t($ => $.hub.agenda.untitled)}
        secondary={
          <>
            {new Date(`${item.date}T00:00:00`).toLocaleDateString(i18n.resolvedLanguage ?? 'en', {
              day: 'numeric', month: 'short', year: 'numeric',
            })}
            {' · '}
            {t($ => $.hub.agenda.type[item.type])}
          </>
        }
      />
      {item.tenantName && <Chip size="small" label={item.tenantName} />}
    </ListItemButton>
  )

  const shownItems = view === 'month' ? agenda : past
  const emptyKey = view === 'month' ? 'empty' : 'pastEmpty'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{t($ => $.hub.title)}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t($ => $.hub.subtitle)}
        </Typography>
      </Box>

      {failed && <Alert severity="error">{t($ => $.hub.loadError)}</Alert>}

      <Paper variant="outlined" sx={{ p: isCompact ? 1.5 : 3 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
            {t($ => $.hub.agenda.title)}
          </Typography>
          {view === 'month' && (
            <>
              <IconButton
                size="small"
                aria-label={t($ => $.hub.agenda.prevMonth)}
                onClick={() => setCursorMonth(shiftMonth(year, month, -1))}
              >
                <ChevronLeftIcon />
              </IconButton>
              <Typography variant="body2">
                {new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
                  i18n.resolvedLanguage ?? 'en', { month: 'long', year: 'numeric', timeZone: 'UTC' },
                )}
              </Typography>
              <IconButton
                size="small"
                aria-label={t($ => $.hub.agenda.nextMonth)}
                onClick={() => setCursorMonth(shiftMonth(year, month, 1))}
              >
                <ChevronRightIcon />
              </IconButton>
            </>
          )}
          <Button
            size="small"
            onClick={() => (view === 'month' ? showPast() : setView('month'))}
          >
            {view === 'month' ? t($ => $.hub.agenda.pastToggle) : t($ => $.hub.agenda.upcomingToggle)}
          </Button>
        </Stack>

        {shownItems.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.hub.agenda[emptyKey])}
          </Typography>
        ) : (
          <List dense disablePadding>{shownItems.map(itemRow)}</List>
        )}

        {view === 'past' && pastCursor && (
          <Button sx={{ mt: 1 }} onClick={() => { void loadPast(pastCursor) }}>
            {t($ => $.hub.agenda.loadMore)}
          </Button>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: isCompact ? 1.5 : 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.hub.earnings.title)}
        </Typography>
        {/* Two sets of books stay two sets of books — this view never totals. */}
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 1.5 }}>
          {t($ => $.hub.earnings.help)}
        </Typography>

        {earnings.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.hub.earnings.empty)}
          </Typography>
        ) : isCompact ? (
          <Stack spacing={1}>
            {earnings.map((row) => (
              <Card key={String(row.tenantId)} variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{row.tenantName}</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t($ => $.hub.earnings.revenue)}: {formatEur(row.revenueCents)}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t($ => $.hub.earnings.expenses)}: {formatEur(row.expenseCents)}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t($ => $.hub.earnings.result)}: {formatEur(row.resultCents)}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Stack>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t($ => $.hub.earnings.band)}</TableCell>
                  <MoneyHeaderCells label={t($ => $.hub.earnings.revenue)} />
                  <MoneyHeaderCells label={t($ => $.hub.earnings.expenses)} />
                  <MoneyHeaderCells label={t($ => $.hub.earnings.result)} />
                </TableRow>
              </TableHead>
              <TableBody>
                {earnings.map((row) => (
                  <TableRow key={String(row.tenantId)}>
                    <TableCell>{row.tenantName}</TableCell>
                    <MoneyCells cents={row.revenueCents} />
                    <MoneyCells cents={row.expenseCents} />
                    <MoneyCells cents={row.resultCents} bold />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>
    </Box>
  )
}
