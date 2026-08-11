import { useState, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs, { type Dayjs } from 'dayjs'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Popover from '@mui/material/Popover'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import PersonIcon from '@mui/icons-material/Person'
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar'
import type { Id, Member } from '../../types/entities.ts'

const ISO_DATE = 'YYYY-MM-DD'

function formatDueDate(value: string, locale: string): string {
  const date = dayjs(value)
  if (!date.isValid()) return value
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date.toDate())
}

interface MetaButtonProps {
  icon: ReactNode
  text?: string
  label: string
  overdue?: boolean
  readOnly?: boolean
  disabled?: boolean
  onOpen?: () => void
  onClick: (event: MouseEvent<HTMLElement>) => void
}

// The second row of a task card: an icon that stands alone while the value is
// empty and grows a label once it is set, so an untouched task stays quiet.
function MetaButton({
  icon,
  text,
  label,
  overdue = false,
  readOnly = false,
  disabled = false,
  onOpen,
  onClick,
}: Readonly<MetaButtonProps>) {
  const color = overdue ? 'error.main' : 'text.secondary'

  if (readOnly) {
    if (!text) return null
    return (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color, px: 1, py: 0.5 }}>
        {icon}
        <Typography variant="caption">{text}</Typography>
      </Stack>
    )
  }

  return (
    <Button
      size="small"
      color="inherit"
      aria-label={label}
      disabled={disabled}
      onMouseDown={onOpen}
      onClick={onClick}
      sx={{ minWidth: 0, maxWidth: 200, px: 1, color, textTransform: 'none', fontWeight: 400 }}
    >
      {icon}
      {text && (
        <Box
          component="span"
          sx={{ ml: 0.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {text}
        </Box>
      )}
    </Button>
  )
}

interface TaskDueControlProps {
  value: string | null
  label: string
  overdue?: boolean
  readOnly?: boolean
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  onChange: (next: string | null) => void
}

export function TaskDueControl({
  value,
  label,
  overdue = false,
  readOnly = false,
  disabled = false,
  onOpenChange,
  onChange,
}: Readonly<TaskDueControlProps>) {
  const { t, i18n } = useTranslation('gigs')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const button = (
    <MetaButton
      icon={<CalendarMonthIcon fontSize="small" />}
      text={value ? formatDueDate(value, i18n.language) : undefined}
      label={label}
      overdue={overdue}
      readOnly={readOnly}
      disabled={disabled}
      onOpen={() => onOpenChange?.(true)}
      onClick={(event) => {
        setAnchor(event.currentTarget)
        onOpenChange?.(true)
      }}
    />
  )
  if (readOnly) return button

  function pick(next: string | null) {
    setAnchor(null)
    onChange(next)
    onOpenChange?.(false)
  }

  function close() {
    setAnchor(null)
    onOpenChange?.(false)
  }

  return (
    <>
      {button}
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <DateCalendar
          value={value ? dayjs(value) : null}
          onChange={(next: Dayjs | null) => pick(next ? next.format(ISO_DATE) : null)}
        />
        {value && (
          <Box sx={{ px: 1, pb: 1 }}>
            <Button size="small" onClick={() => pick(null)}>
              {t($ => $.tasks.clearDueDate)}
            </Button>
          </Box>
        )}
      </Popover>
    </>
  )
}

interface TaskAssigneeControlProps {
  value: Id | null
  members: Member[]
  label: string
  readOnly?: boolean
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  onChange: (next: Id | null) => void
}

export function TaskAssigneeControl({
  value,
  members,
  label,
  readOnly = false,
  disabled = false,
  onOpenChange,
  onChange,
}: Readonly<TaskAssigneeControlProps>) {
  const { t } = useTranslation('gigs')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const assignee = members.find((member) => member.id === value)
  // Nobody to pick from — the control would open an empty menu.
  if (members.length === 0) return null

  const button = (
    <MetaButton
      icon={<PersonIcon fontSize="small" />}
      text={assignee?.name}
      label={label}
      readOnly={readOnly}
      disabled={disabled}
      onOpen={() => onOpenChange?.(true)}
      onClick={(event) => {
        setAnchor(event.currentTarget)
        onOpenChange?.(true)
      }}
    />
  )
  if (readOnly) return button

  function pick(next: Id | null) {
    setAnchor(null)
    onChange(next)
    onOpenChange?.(false)
  }

  function close() {
    setAnchor(null)
    onOpenChange?.(false)
  }

  return (
    <>
      {button}
      <Menu open={Boolean(anchor)} anchorEl={anchor} onClose={close}>
        <MenuItem selected={value == null} onClick={() => pick(null)}>
          {t($ => $.tasks.unassigned)}
        </MenuItem>
        {members.map((member) => (
          <MenuItem key={String(member.id)} selected={member.id === value} onClick={() => pick(member.id ?? null)}>
            {member.name}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
