import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardActions from '@mui/material/CardActions'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { countryLabel } from '../../utils/countries.ts'
import type { Id, MyBand } from '../../types/entities.ts'

/**
 * One row of the list, from either of its two sources. `onGigbuddy` decides
 * everything else about the row, so the union is discriminated on it rather
 * than on which optional fields happen to be set.
 */
export type MyBandsRow =
  | {
    key: string
    name: string
    onGigbuddy: true
    tenantId: Id
    membershipStatus: string
    avatarPath: string | null
  }
  | {
    key: string
    name: string
    onGigbuddy: false
    myBand: MyBand
  }

interface MyBandsTableProps {
  rows: MyBandsRow[]
  onOpen: (tenantId: Id) => void
  onEdit: (profileId: Id) => void
  onRemove: (band: MyBand) => void
  onLeave: (tenantId: Id, bandName: string) => void
}

const totalEvents = (band: MyBand) =>
  band.eventCounts.gigs + band.eventCounts.rehearsals + band.eventCounts.bandEvents

export default function MyBandsTable({
  rows, onOpen, onEdit, onRemove, onLeave,
}: Readonly<MyBandsTableProps>) {
  const { t, i18n } = useTranslation(['myBands', 'common'])
  const isCompact = useCompactLayout()

  function statusChip(row: MyBandsRow) {
    if (row.onGigbuddy) {
      const pending = row.membershipStatus !== 'approved'
      return (
        <Chip
          size="small"
          color={pending ? 'default' : 'success'}
          label={pending ? t($ => $.status.pendingMembership) : t($ => $.status.onGigbuddy)}
        />
      )
    }
    const { status } = row.myBand.bandProfile
    return <Chip size="small" color={status === 'claimed' ? 'info' : 'default'} label={t($ => $.status[status])} />
  }

  function countryOf(row: MyBandsRow) {
    if (row.onGigbuddy) return ''
    return countryLabel(row.myBand.bandProfile.countryCode, i18n.language)
  }

  function eventsOf(row: MyBandsRow) {
    if (row.onGigbuddy) return ''
    return t($ => $.eventCount, { count: totalEvents(row.myBand) })
  }

  // A gigbuddy band is entered by switching workspace; a profile is edited in
  // place, and only by whoever created it.
  function actions(row: MyBandsRow) {
    if (row.onGigbuddy) {
      const pending = row.membershipStatus !== 'approved'
      return (
        <>
          <Button size="small" disabled={pending} onClick={() => onOpen(row.tenantId)}>
            {t($ => $.actions.open)}
          </Button>
          <Button size="small" color="error" onClick={() => onLeave(row.tenantId, row.name)}>
            {t($ => $.actions.leave)}
          </Button>
        </>
      )
    }

    const { bandProfile } = row.myBand
    const editable = bandProfile.canEdit !== false && bandProfile.status === 'claimable'
    return (
      <>
        <Tooltip title={editable ? '' : t($ => $.readOnly)}>
          <span>
            <Button size="small" disabled={!editable} onClick={() => onEdit(bandProfile.id)}>
              {t($ => $.actions.edit)}
            </Button>
          </span>
        </Tooltip>
        <Button size="small" color="error" onClick={() => onRemove(row.myBand)}>
          {t($ => $.actions.remove)}
        </Button>
      </>
    )
  }

  if (isCompact) {
    return (
      <Stack spacing={1.5}>
        {rows.map((row) => (
          <Card key={row.key} variant="outlined">
            <CardContent sx={{ pb: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>{row.name}</Typography>
                {statusChip(row)}
              </Stack>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {[countryOf(row), eventsOf(row)].filter(Boolean).join(' · ')}
              </Typography>
              {!row.onGigbuddy && row.myBand.bandProfile.status === 'claimed' && (
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                  {t($ => $.claimedHint)}
                </Typography>
              )}
            </CardContent>
            <CardActions sx={{ justifyContent: 'flex-end', px: 1, py: 0.5, gap: 0.5 }}>
              {actions(row)}
            </CardActions>
          </Card>
        ))}
      </Stack>
    )
  }

  return (
    <Paper variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t($ => $.table.columns.band)}</TableCell>
            <TableCell>{t($ => $.table.columns.country)}</TableCell>
            <TableCell>{t($ => $.table.columns.status)}</TableCell>
            <TableCell>{t($ => $.table.columns.events)}</TableCell>
            <TableCell align="right">{t($ => $.table.columns.actions)}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>{row.name}</Typography>
                {!row.onGigbuddy && row.myBand.bandProfile.status === 'claimed' && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t($ => $.claimedHint)}
                  </Typography>
                )}
              </TableCell>
              <TableCell>{countryOf(row)}</TableCell>
              <TableCell>{statusChip(row)}</TableCell>
              <TableCell>{eventsOf(row)}</TableCell>
              <TableCell align="right">
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                  {actions(row)}
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  )
}
