import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import GigStatusIcon from '../../../planning/gigs/components/GigStatusIcon.tsx'
import { useCompactLayout } from '../../../hooks/useCompactLayout.ts'
import { formatShortDate } from '../../../utils/dateFormat.ts'
import { listVenueEvents } from '../venues.ts'
import type { Gig, Id } from '../../../types/entities.ts'
import type { ListCollectionCursor } from '../../../types/api.ts'

const PAGE_SIZE = 10

interface LoadedPage {
  items: Gig[]
  nextCursor: ListCollectionCursor | null
}

interface VenueEventsListProps {
  venueId: Id
  /** Panels stay mounted across tab switches; fetch only once opened. */
  active: boolean
  /** Pending field edits are flushed before navigating away. */
  onBeforeNavigate?: () => Promise<void>
}

function formatTime(value: string | null | undefined): string {
  return value ? String(value).slice(0, 5) : ''
}

function timeRange(gig: Gig): string {
  const start = formatTime(gig.start_time)
  const end = formatTime(gig.end_time)
  if (start && end) return `${start}–${end}`
  return start || end || '—'
}

/** The gigs played at this venue, newest first, walked with a keyset cursor. */
export default function VenueEventsList({ venueId, active, onBeforeNavigate }: Readonly<VenueEventsListProps>) {
  const { t } = useTranslation('venues')
  const navigate = useNavigate()
  const isCompact = useCompactLayout()
  // null until the first page lands — the spinner is derived from that rather
  // than from a flag an effect would have to set.
  const [page, setPage] = useState<LoadedPage | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    listVenueEvents(venueId, PAGE_SIZE, undefined, { signal: controller.signal })
      .then((result) => setPage({ items: result.items, nextCursor: result.meta.nextCursor }))
      .catch((error: Error) => { if (!controller.signal.aborted) console.error(error) })
    return () => controller.abort()
  }, [venueId, active])

  async function loadMore(cursor: ListCollectionCursor) {
    setLoadingMore(true)
    try {
      const result = await listVenueEvents(venueId, PAGE_SIZE, cursor)
      setPage((current) => ({
        items: [...(current?.items ?? []), ...result.items],
        nextCursor: result.meta.nextCursor,
      }))
    } finally {
      setLoadingMore(false)
    }
  }

  async function openGig(id: Id) {
    await onBeforeNavigate?.()
    navigate(`/gigs/${id}`)
  }

  if (page === null) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (page.items.length === 0) {
    return <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t($ => $.detail.noEvents)}</Typography>
  }

  const title = (gig: Gig) => gig.event_description || t($ => $.categoryChange.untitled)

  return (
    <>
      {isCompact ? (
        page.items.map((gig) => (
          <Box
            key={String(gig.id)}
            component="button"
            type="button"
            onClick={() => { void openGig(gig.id as Id) }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              width: '100%',
              mb: 1,
              p: 1,
              pl: 1.5,
              font: 'inherit',
              color: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: 'transparent',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <GigStatusIcon status={gig.status} size={28} />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>{title(gig)}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {formatShortDate(gig.event_date)} · {timeRange(gig)}
              </Typography>
            </Box>
          </Box>
        ))
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {/* The status icon speaks for itself — an empty header keeps the
                    column from claiming width it doesn't need. */}
                <TableCell padding="none" sx={{ pl: 1, width: 40 }} />
                <TableCell>{t($ => $.detail.eventsTable.event)}</TableCell>
                <TableCell>{t($ => $.detail.eventsTable.date)}</TableCell>
                <TableCell>{t($ => $.detail.eventsTable.time)}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {page.items.map((gig) => (
                <TableRow
                  key={String(gig.id)}
                  hover
                  onClick={() => { void openGig(gig.id as Id) }}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell padding="none" align="center" sx={{ pl: 1, width: 40 }}>
                    <GigStatusIcon status={gig.status} />
                  </TableCell>
                  <TableCell>{title(gig)}</TableCell>
                  <TableCell>{formatShortDate(gig.event_date)}</TableCell>
                  <TableCell>{timeRange(gig)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {page.nextCursor && (
        <Button
          size="small"
          onClick={() => { void loadMore(page.nextCursor as ListCollectionCursor) }}
          disabled={loadingMore}
          sx={{ mt: 1 }}
        >
          {t($ => $.detail.loadMoreEvents)}
        </Button>
      )}
    </>
  )
}
