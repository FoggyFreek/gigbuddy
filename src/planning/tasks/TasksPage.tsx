import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ToggleButton from '@mui/material/ToggleButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import FilterListIcon from '@mui/icons-material/FilterList'
import TasksTable from './components/TasksTable.tsx'
import TaskFormDialog from './components/TaskFormDialog.tsx'
import { useAuth } from '../../contexts/authContext.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import { updateTask } from './tasks.ts'
import { setMyTaskDone } from '../availability/me.ts'
import { usePlanningSource } from '../shared/usePlanningSource.ts'
import { isCrossTenantRow } from '../shared/useCrossTenantRow.ts'
import { useCrossTenantNavigate } from '../shared/useCrossTenantNavigate.ts'
import type { Id, Task } from '../../types/entities.ts'
import type { MaybeCrossTenant } from '../../types/api.ts'

// The page serves both tenant kinds: a band reads the tenant-scoped `/tasks`,
// a personal workspace the cross-tenant `/api/me/tasks`, whose rows carry the
// owning band's label.
type TaskItem = MaybeCrossTenant<Task>

const FILTER_SX = { height: 31 } as const
const TASK_LIST_LIMIT = 50

// Stable empty fallback: a fresh [] each render would change the identity of
// every memo and effect that depends on the task list.
const NO_TASKS: TaskItem[] = []
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
  const source = usePlanningSource('tasks')
  const openInTenant = useCrossTenantNavigate()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isCompact = useCompactLayout()
  const [myTasksOnly, setMyTasksOnly] = useState(false)
  // Finished tasks stay hidden by default; both statuses selected shows everything.
  const [selectedStatuses, setSelectedStatuses] = useState<Set<TaskStatus>>(() => new Set(['open']))
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)

  // Tasks are tagged with the request they answered, so `loading` and `error`
  // are derived from whether the newest request has landed. A silent reload
  // refreshes the rows in place instead of swapping them for a spinner.
  const [reloadNonce, setReloadNonce] = useState(0)
  const [silentReload, setSilentReload] = useState(false)
  const reload = useCallback((silent = false) => {
    setSilentReload(silent)
    setReloadNonce((n) => n + 1)
  }, [])
  const tasksKey = `${source.kind}|${reloadNonce}`
  const [tasksState, setTasksState] = useState<{ key: string; tasks: TaskItem[]; error: string | null } | null>(null)
  const tasks = tasksState?.tasks ?? NO_TASKS
  const loading = tasksState == null || (tasksState.key !== tasksKey && !silentReload)
  const error = tasksState?.key === tasksKey ? tasksState.error : null

  useEffect(() => {
    let cancelled = false
    source.api.list({ limit: TASK_LIST_LIMIT })
      .then((response) => {
        if (!cancelled) setTasksState({ key: tasksKey, tasks: response.items, error: null })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setTasksState((prev) => ({
            key: tasksKey,
            tasks: prev?.tasks ?? [],
            error: e instanceof Error ? e.message : String(e),
          }))
        }
      })
    return () => { cancelled = true }
  }, [tasksKey, source])

  // Hub rows are the caller's own tasks across their bands, so ticking one done
  // is always allowed — the server authorizes the self-action. In a band
  // workspace it takes planning.write, or the task being the viewer's own.
  const canToggleDone = useCallback(
    (task: TaskItem) => source.labelsTenant
      || canWritePlanning
      || (task.assigned_to != null && task.assigned_to === user?.bandMemberId),
    [source, canWritePlanning, user?.bandMemberId],
  )

  // Editing a task is an ordinary tenant-scoped write, so it needs the row to
  // belong to the active tenant.
  const canEditTask = useCallback(
    (task: TaskItem) => !isCrossTenantRow(task, user?.activeTenantId),
    [user?.activeTenantId],
  )

  // Deep links are derived from the loaded list, so opening the dialog does not
  // require a state-setting effect. The close event consumes the query param.
  const taskParam = searchParams.get('task')
  const deepLinkedTask = !loading && taskParam && canWritePlanning
    ? tasks.find((task) => String(task.id) === taskParam && canEditTask(task)) ?? null
    : null

  function consumeTaskParam() {
    if (!taskParam || !deepLinkedTask) return
    setEditingTask(deepLinkedTask)
    setDialogOpen(true)
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.delete('task')
      return next
    }, { replace: true })
  }

  async function handleToggle(task: TaskItem) {
    if (task.id === undefined) return
    setTasksState((prev) => (prev
      ? { ...prev, tasks: prev.tasks.map((x) => (x.id === task.id ? { ...x, done: !x.done } : x)) }
      : prev))
    try {
      // Another band's task is out of reach of /tasks; the hub's self-action is
      // the only way to tick it done.
      if (canEditTask(task)) await updateTask(task.id, { done: !task.done })
      else await setMyTaskDone(task.id, !task.done)
    } finally {
      reload(true)
    }
  }

  function openCreate() {
    setEditingTask(null)
    setDialogOpen(true)
  }

  function openEdit(task: TaskItem) {
    setEditingTask(task)
    setDialogOpen(true)
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

  // "My tasks" filters on the viewer's band member id, which only identifies
  // them inside the active tenant — meaningless once rows span several bands.
  const showMyTasksFilter = !source.labelsTenant && !!user?.bandMemberId
  const memberTasks = tasks
    .filter((task) => source.labelsTenant || !myTasksOnly || !user?.bandMemberId || task.assigned_to === user.bandMemberId)
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
              onClose={() => setFilterAnchor(null)}
            >
              {showMyTasksFilter && (
                <MenuItem dense onClick={() => setMyTasksOnly((v) => !v)}>
                  <Checkbox size="small" checked={myTasksOnly} />
                  <ListItemText primary={t($ => $.myTasks)} />
                </MenuItem>
              )}
              {showMyTasksFilter && <Divider />}
              {statusMenuItems()}
            </Menu>
          </>
        ) : (
          <>
            {showMyTasksFilter && (
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
          onOpenGigTask={(gigId: Id, task: TaskItem) => {
            if (isCrossTenantRow(task, user?.activeTenantId)) {
              void openInTenant(task.tenantId, `/gigs/${gigId}?tab=tasks`)
            } else navigate(`/gigs/${gigId}?tab=tasks`)
          }}
          onOpenTask={(task) => {
            if (isCrossTenantRow(task, user?.activeTenantId)) {
              void openInTenant(task.tenantId, '/tasks')
            }
          }}
          onEditTask={canWritePlanning ? openEdit : undefined}
          canEditTask={canEditTask}
        />
      )}

      <TaskFormDialog
        open={dialogOpen || deepLinkedTask !== null}
        task={editingTask ?? deepLinkedTask}
        onClose={() => setDialogOpen(false)}
        onSaved={() => reload()}
        onDeleted={() => reload()}
        onEnter={consumeTaskParam}
      />
    </>
  )
}
