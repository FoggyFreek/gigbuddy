import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import ToggleButton from '@mui/material/ToggleButton'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import FilterAltIcon from '@mui/icons-material/FilterAlt'
import TasksTable from '../components/TasksTable.tsx'
import TaskFormDialog from '../components/TaskFormDialog.tsx'
import { useAuth } from '../contexts/authContext.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { listAllTasks, updateTask } from '../api/tasks.ts'
import type { Id, Task } from '../types/entities.ts'

const FILTER_SX = { height: 31 } as const

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
  const navigate = useNavigate()
  const isCompact = useCompactLayout()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [myTasksOnly, setMyTasksOnly] = useState(false)
  const [showFinished, setShowFinished] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null)

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      setError(null)
      setTasks(await listAllTasks())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const canToggleDone = useCallback(
    (task: Task) =>
      canWritePlanning || (task.assigned_to != null && task.assigned_to === user?.bandMemberId),
    [canWritePlanning, user?.bandMemberId],
  )

  async function handleToggle(task: Task) {
    if (task.id === undefined) return
    setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, done: !x.done } : x)))
    try {
      await updateTask(task.id, { done: !task.done })
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

  const memberTasks = tasks
    .filter((task) => !myTasksOnly || !user?.bandMemberId || task.assigned_to === user.bandMemberId)
  const gigsWithOpenTasks = new Set(
    memberTasks
      .filter((task) => !task.done && task.gig_id != null)
      .map((task) => String(task.gig_id)),
  )
  const visibleTasks = memberTasks.filter(
    (task) =>
      showFinished
      || !task.done
      || (task.gig_id != null && gigsWithOpenTasks.has(String(task.gig_id))),
  )

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
              color={myTasksOnly || showFinished ? 'primary' : 'default'}
              sx={COMPACT_FILTER_SX}
            >
              <FilterAltIcon />
            </IconButton>
            <Menu
              anchorEl={filterAnchor}
              open={Boolean(filterAnchor)}
              onClose={() => setFilterAnchor(null)}
            >
              {user?.bandMemberId && (
                <MenuItem selected={myTasksOnly} onClick={() => setMyTasksOnly((v) => !v)}>
                  {t($ => $.myTasks)}
                </MenuItem>
              )}
              <MenuItem selected={showFinished} onClick={() => setShowFinished((v) => !v)}>
                {t($ => $.showFinished)}
              </MenuItem>
            </Menu>
          </>
        ) : (
          <>
            {user?.bandMemberId && (
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
            <ToggleButton
              value="showFinished"
              selected={showFinished}
              onChange={() => setShowFinished((v) => !v)}
              aria-label={t($ => $.showFinished)}
              sx={FILTER_SX}
            >
              {t($ => $.showFinished)}
            </ToggleButton>
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
          onEditTask={canWritePlanning ? openEdit : undefined}
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
