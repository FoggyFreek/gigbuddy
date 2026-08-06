import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import ToggleButton from '@mui/material/ToggleButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FilterListIcon from '@mui/icons-material/FilterList'
import TasksTable from '../components/TasksTable.tsx'
import TaskFormDialog from '../components/TaskFormDialog.tsx'
import { useAuth } from '../contexts/authContext.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { listTasks, updateTask } from '../api/tasks.ts'
import { listMyTasks, setMyTaskDone } from '../api/me.ts'
import { useTenantKind } from '../hooks/useTenantKind.ts'
import { useCrossTenantNavigate } from '../hooks/useCrossTenantNavigate.ts'
import type { Id, Task } from '../types/entities.ts'

const FILTER_SX = { height: 31 } as const
const DEFAULT_TASK_LIST_LIMIT = 50
const TASK_LIST_LIMIT_OPTIONS = [50, 100, 200, 500] as const
const TASK_STATUSES = ['open', 'finished'] as const

type TaskStatus = typeof TASK_STATUSES[number]

const COMPACT_FILTER_SX = {
  ...FILTER_SX,
  minWidth: 31,
  p: 0,
  '& .MuiSvgIcon-root': { fontSize: 20 },
} as const

export default function TasksPage() {
  const { t } = useTranslation('tasks')
  const { user } = useAuth()
  const { canWritePlanning } = usePermissions()
  const { isPersonal } = useTenantKind()
  const openInTenant = useCrossTenantNavigate()
  const navigate = useNavigate()
  const isCompact = useCompactLayout()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [myTasksOnly, setMyTasksOnly] = useState(false)
  // Finished tasks stay hidden by default; both statuses selected shows everything.
  const [selectedStatuses, setSelectedStatuses] = useState<Set<TaskStatus>>(() => new Set(['open']))
  const [taskLimit, setTaskLimit] = useState(DEFAULT_TASK_LIST_LIMIT)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)
  const [taskLimitAnchor, setTaskLimitAnchor] = useState<HTMLElement | null>(null)

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      setError(null)
      const response = await (isPersonal
        ? listMyTasks({ limit: taskLimit })
        : listTasks({ limit: taskLimit }))
      setTasks(response.items)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [taskLimit, isPersonal])

  useEffect(() => { load() }, [load])

  const canToggleDone = useCallback(
    (task: Task) => isPersonal
      ? task.tenantId === user?.activeTenantId || task.tenantId != null
      : canWritePlanning || (task.assigned_to != null && task.assigned_to === user?.bandMemberId),
    [isPersonal, user?.activeTenantId, canWritePlanning, user?.bandMemberId],
  )

  const canEditTask = useCallback(
    (task: Task) => !isPersonal || task.tenantId === user?.activeTenantId,
    [isPersonal, user?.activeTenantId],
  )

  async function handleToggle(task: Task) {
    if (task.id === undefined) return
    setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, done: !x.done } : x)))
    try {
      if (isPersonal && task.tenantId !== user?.activeTenantId) {
        await setMyTaskDone(task.id, !task.done)
      } else {
        await updateTask(task.id, { done: !task.done })
      }
    } finally {
      load(true)
    }
  }

  function openCreate() {
    setEditingTask(null)
    setDialogOpen(true)
  }

  function openEdit(task: Task) {
    setEditingTask(task)
    setDialogOpen(true)
  }

  function closeCompactMenus() {
    setTaskLimitAnchor(null)
    setFilterAnchor(null)
  }

  function selectTaskLimit(limit: number) {
    setTaskLimit(limit)
    closeCompactMenus()
  }

  function toggleStatus(status: TaskStatus) {
    setSelectedStatuses((previous) => {
      const next = new Set(previous)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  function toggleAllStatuses() {
    setSelectedStatuses((previous) =>
      previous.size === TASK_STATUSES.length ? new Set() : new Set(TASK_STATUSES),
    )
  }

  const showOpen = selectedStatuses.has('open')
  const showFinished = selectedStatuses.has('finished')
  const allStatusesSelected = selectedStatuses.size === TASK_STATUSES.length
  const someStatusesSelected = selectedStatuses.size > 0 && !allStatusesSelected

  const memberTasks = tasks
    .filter((task) => isPersonal || !myTasksOnly || !user?.bandMemberId || task.assigned_to === user.bandMemberId)
  const gigsWithOpenTasks = new Set(
    memberTasks
      .filter((task) => !task.done && task.gig_id != null)
      .map((task) => String(task.gig_id)),
  )
  const visibleTasks = memberTasks.filter((task) => {
    if (!task.done) return showOpen
    if (showFinished) return true
    // A finished task stays in view for context while its gig still has open ones.
    return showOpen && task.gig_id != null && gigsWithOpenTasks.has(String(task.gig_id))
  })

  // Returned as a flat array so MUI's Menu keeps its keyboard navigation
  // (a Fragment child would hide the items from it).
  const statusMenuItems = () => [
    <MenuItem key="all" dense onClick={toggleAllStatuses}>
      <Checkbox size="small" checked={allStatusesSelected} indeterminate={someStatusesSelected} />
      <ListItemText primary={t($ => $.allStatuses)} />
    </MenuItem>,
    <Divider key="all-divider" />,
    ...TASK_STATUSES.map((status) => (
      <MenuItem key={status} dense onClick={() => toggleStatus(status)}>
        <Checkbox size="small" checked={selectedStatuses.has(status)} />
        <ListItemText primary={t($ => $.status[status])} />
      </MenuItem>
    )),
  ]

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {t($ => $.title)}
        </Typography>
        {isCompact ? (
          <>
            <IconButton
              aria-label={t($ => $.filters)}
              onClick={(e) => setFilterAnchor(e.currentTarget)}
              color={myTasksOnly || someStatusesSelected ? 'primary' : 'default'}
              sx={COMPACT_FILTER_SX}
            >
              <FilterListIcon />
            </IconButton>
            <Menu
              anchorEl={filterAnchor}
              open={Boolean(filterAnchor)}
              onClose={closeCompactMenus}
            >
              {!isPersonal && user?.bandMemberId && (
                <MenuItem dense onClick={() => setMyTasksOnly((v) => !v)}>
                  <Checkbox size="small" checked={myTasksOnly} />
                  <ListItemText primary={t($ => $.myTasks)} />
                </MenuItem>
              )}
              {!isPersonal && user?.bandMemberId && <Divider />}
              {statusMenuItems()}
              <Divider />
              <MenuItem
                aria-haspopup="menu"
                aria-expanded={Boolean(taskLimitAnchor)}
                onClick={(e) => setTaskLimitAnchor(e.currentTarget)}
              >
                <ListItemText>{t($ => $.maxTaskLimit)}</ListItemText>
                <ChevronRightIcon fontSize="small" />
              </MenuItem>
            </Menu>
            <Menu
              anchorEl={taskLimitAnchor}
              open={Boolean(taskLimitAnchor)}
              onClose={() => setTaskLimitAnchor(null)}
              anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            >
              {TASK_LIST_LIMIT_OPTIONS.map((limit) => (
                <MenuItem
                  key={limit}
                  selected={taskLimit === limit}
                  onClick={() => selectTaskLimit(limit)}
                >
                  {limit}
                </MenuItem>
              ))}
            </Menu>
          </>
        ) : (
          <>
            {!isPersonal && user?.bandMemberId && (
              <ToggleButton
                value="myTasks"
                selected={myTasksOnly}
                onChange={() => setMyTasksOnly((v) => !v)}
                aria-label={t($ => $.myTasks)}
                sx={FILTER_SX}
              >
                {t($ => $.myTasks)}
              </ToggleButton>
            )}
            <Tooltip title={t($ => $.filters)}>
              <IconButton
                aria-label={t($ => $.filters)}
                color={someStatusesSelected ? 'primary' : 'default'}
                onClick={(e) => setFilterAnchor(e.currentTarget)}
              >
                <FilterListIcon />
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={filterAnchor}
              open={Boolean(filterAnchor)}
              onClose={() => setFilterAnchor(null)}
            >
              {statusMenuItems()}
            </Menu>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel id="task-limit-label">{t($ => $.taskLimit)}</InputLabel>
              <Select
                labelId="task-limit-label"
                value={taskLimit}
                label={t($ => $.taskLimit)}
                onChange={(e) => setTaskLimit(Number(e.target.value))}
                sx={FILTER_SX}
              >
                {TASK_LIST_LIMIT_OPTIONS.map((limit) => (
                  <MenuItem key={limit} value={limit}>{limit}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </>
        )}
        {canWritePlanning && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            {t($ => $.newTask)}
          </Button>
        )}
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Typography sx={{ mb: 2, color: 'error.main' }}>
          {error}
        </Typography>
      )}

      {!loading && (
        <TasksTable
          tasks={visibleTasks}
          onToggleDone={handleToggle}
          canToggleDone={canToggleDone}
          onOpenGig={(gigId: Id) => navigate(`/gigs/${gigId}?tab=tasks`)}
          onOpenGigTask={(gigId: Id, task: Task) => {
            if (isPersonal && task.tenantId !== user?.activeTenantId) {
              void openInTenant(task.tenantId, `/gigs/${gigId}?tab=tasks`)
            } else navigate(`/gigs/${gigId}?tab=tasks`)
          }}
          onOpenTask={(task) => {
            if (isPersonal && task.tenantId !== user?.activeTenantId) {
              void openInTenant(task.tenantId, '/tasks')
            }
          }}
          onEditTask={canWritePlanning ? openEdit : undefined}
          canEditTask={canEditTask}
        />
      )}

      <TaskFormDialog
        open={dialogOpen}
        task={editingTask}
        onClose={() => setDialogOpen(false)}
        onSaved={load}
        onDeleted={load}
      />
    </>
  )
}
