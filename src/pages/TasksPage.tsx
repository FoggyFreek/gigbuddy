import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import ToggleButton from '@mui/material/ToggleButton'
import Typography from '@mui/material/Typography'
import TasksTable from '../components/TasksTable.tsx'
import type { GigTask } from '../components/TasksTable.tsx'
import { useAuth } from '../contexts/authContext.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import { listAllTasks } from '../api/tasks.ts'
import { updateTask } from '../api/gigs.ts'
import type { Id } from '../types/entities.ts'

// GigTask extended with the gig_id needed for navigation to the gig detail page
interface Task extends GigTask {
  gig_id?: Id
}

export default function TasksPage() {
  const { user } = useAuth()
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [myTasksOnly, setMyTasksOnly] = useState(false)
  const [showFinished, setShowFinished] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listAllTasks()
      setTasks(data as Task[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleToggle(task: Task) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)))
    if (task.gig_id === undefined || task.id === undefined) { load(); return }
    try {
      await updateTask(task.gig_id, task.id, { done: !task.done })
    } finally {
      load()
    }
  }

  const visibleTasks = tasks
    .filter((t) => showFinished || !t.done)
    .filter((t) => !myTasksOnly || !user?.bandMemberId || t.assigned_to === user.bandMemberId)

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600,  flexGrow: 1  }}>
          Tasks
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {user?.bandMemberId && (
            <ToggleButton
              value="myTasks"
              selected={myTasksOnly}
              onChange={() => setMyTasksOnly((v) => !v)}
              size="small"
            >
              My tasks
            </ToggleButton>
          )}
          <ToggleButton
            value="showFinished"
            selected={showFinished}
            onChange={() => setShowFinished((v) => !v)}
            size="small"
          >
            Show finished
          </ToggleButton>
        </Box>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {!loading && (
        <TasksTable
          tasks={visibleTasks}
          onRowClick={canWritePlanning
            ? (task) => { const gigId = (task as Task).gig_id; if (gigId !== undefined) navigate(`/gigs/${gigId}`) }
            : undefined}
          onToggleDone={handleToggle}
        />
      )}
    </>
  )
}
