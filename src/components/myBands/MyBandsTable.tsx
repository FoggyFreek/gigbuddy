import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography, { type TypographyProps } from '@mui/material/Typography'
import SyncIcon from '@mui/icons-material/Sync'
import LogoutIcon from '@mui/icons-material/Logout'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { useThemeMode } from '../../contexts/themeModeContext.ts'
import { countryLabel } from '../../utils/countries.ts'
import { tenantAvatarUrl } from '../../utils/tenantAvatarUrl.ts'
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
    accountingCountryCode: string | null
  }
  | {
    key: string
    name: string
    onGigbuddy: false
    myBand: MyBand
  }
  // A band the artist asked to join and is still waiting on. Withdrawing
  // matters: outstanding requests are capped, so without it an artist whose
  // requests go unanswered is stuck.
  | {
    key: string
    name: string
    onGigbuddy: 'requested'
    tenantId: Id
  }

interface MyBandsTableProps {
  rows: MyBandsRow[]
  onOpen: (tenantId: Id) => void
  onEdit: (profileId: Id) => void
  onRemove: (band: MyBand) => void
  onLeave: (tenantId: Id, bandName: string) => void
  onWithdraw: (tenantId: Id) => void
}

const totalEvents = (band: MyBand) =>
  band.eventCounts.gigs + band.eventCounts.rehearsals + band.eventCounts.bandEvents

const hasGigBuddyStatusIcon = (row: MyBandsRow) =>
  row.onGigbuddy === true && row.membershipStatus === 'approved'

function GigBuddyStatusIcon({ label }: Readonly<{ label: string }>) {
  const { mode } = useThemeMode()

  return (
    <Tooltip title={label}>
      <Box
        component="img"
        src={mode === 'dark' ? '/icons/gb_dark_128.png' : '/icons/gb_light_128.png'}
        alt={label}
        sx={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }}
      />
    </Tooltip>
  )
}

export default function MyBandsTable({
  rows, onOpen, onEdit, onRemove, onLeave, onWithdraw,
}: Readonly<MyBandsTableProps>) {
  const { t, i18n } = useTranslation(['myBands', 'common'])
  const isCompact = useCompactLayout()

  function statusChip(row: MyBandsRow) {
    if (row.onGigbuddy === 'requested') {
      return <Chip size="small" color="warning" label={t($ => $.status.requested)} />
    }
    if (row.onGigbuddy) {
      const pending = row.membershipStatus !== 'approved'
      if (!pending) {
        const label = t($ => $.status.onGigbuddy)
        return <GigBuddyStatusIcon label={label} />
      }
      return (
        <Chip
          size="small"
          label={t($ => $.status.pendingMembership)}
        />
      )
    }
    const { status } = row.myBand.bandProfile
    return <Chip size="small" color={status === 'claimed' ? 'info' : 'default'} label={t($ => $.status[status])} />
  }

  function countryOf(row: MyBandsRow) {
    if (row.onGigbuddy === true) {
      return row.accountingCountryCode ? countryLabel(row.accountingCountryCode, i18n.language) : ''
    }
    if (row.onGigbuddy === 'requested') return ''
    return countryLabel(row.myBand.bandProfile.countryCode, i18n.language)
  }

  function nameOf(row: MyBandsRow, typographyProps: TypographyProps): ReactNode {
    const avatarSrc = row.onGigbuddy === true ? tenantAvatarUrl(row.tenantId, row.avatarPath) : undefined
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        {avatarSrc && <Avatar src={avatarSrc} alt={row.name} sx={{ width: 24, height: 24 }} />}
        <Typography noWrap {...typographyProps}>{row.name}</Typography>
      </Box>
    )
  }

  function eventsOf(row: MyBandsRow) {
    if (row.onGigbuddy !== false) return ''
    return t($ => $.eventCount, { count: totalEvents(row.myBand) })
  }

  // A gigbuddy band is entered by switching workspace; a profile is edited in
  // place, and only by whoever created it.
  function actions(row: MyBandsRow) {
    if (row.onGigbuddy === 'requested') {
      return (
        <Button size="small" color="error" onClick={() => onWithdraw(row.tenantId)}>
          {t($ => $.actions.withdraw)}
        </Button>
      )
    }
    if (row.onGigbuddy) {
      const pending = row.membershipStatus !== 'approved'
      return (
        <>
          <Tooltip title={t($ => $.actions.open)}>
            <span>
              <IconButton
                size="small"
                aria-label={t($ => $.actions.open)}
                disabled={pending}
                onClick={() => onOpen(row.tenantId)}
              >
                <SyncIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t($ => $.actions.leave)}>
            <IconButton
              size="small"
              color="error"
              aria-label={t($ => $.actions.leave)}
              onClick={() => onLeave(row.tenantId, row.name)}
            >
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      )
    }

    const { bandProfile } = row.myBand
    const editable = bandProfile.canEdit !== false && bandProfile.status === 'claimable'
    return (
      <>
        <Tooltip title={editable ? t($ => $.actions.edit) : t($ => $.readOnly)}>
          <span>
            <IconButton
              size="small"
              aria-label={t($ => $.actions.edit)}
              disabled={!editable}
              onClick={() => onEdit(bandProfile.id)}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t($ => $.actions.remove)}>
          <IconButton
            size="small"
            color="error"
            aria-label={t($ => $.actions.remove)}
            onClick={() => onRemove(row.myBand)}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </>
    )
  }

  if (isCompact) {
    return (
      <Stack spacing={1.5}>
        {rows.map((row) => (
          <Card key={row.key} variant="outlined">
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {hasGigBuddyStatusIcon(row) && statusChip(row)}
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mb: 0.5 }}>
                    {nameOf(row, { sx: { fontWeight: 600 } })}
                    {!hasGigBuddyStatusIcon(row) && statusChip(row)}
                  </Box>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {[countryOf(row), eventsOf(row)].filter(Boolean).join(' · ')}
                  </Typography>
                  {row.onGigbuddy === false && row.myBand.bandProfile.status === 'claimed' && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                      {t($ => $.claimedHint)}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                  {actions(row)}
                </Box>
              </Stack>
            </CardContent>
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
                {nameOf(row, { variant: 'body2', sx: { fontWeight: 500 } })}
                {row.onGigbuddy === false && row.myBand.bandProfile.status === 'claimed' && (
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
