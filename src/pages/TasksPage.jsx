import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import ToggleButton from '@mui/material/ToggleButton'
import Typography from '@mui/material/Typography'
import TasksTable from '../components/TasksTable.jsx'
import GigFormModal from '../components/GigFormModal.jsx'
import { useAuth } from '../contexts/authContext.js'
import { listAllTasks } from '../api/tasks.js'
import { updateTask } from '../api/gigs.js'

export default function TasksPage() {
  const { user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // null | { mode: 'edit', gigId: number }
  const [myTasksOnly, setMyTasksOnly] = useState(false)
  const [showFinished, setShowFinished] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listAllTasks()
      setTasks(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleClose() {
    setModal(null)
    load()
  }

  async function handleToggle(task) {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)))
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
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
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
          onRowClick={(task) => setModal({ mode: 'edit', gigId: task.gig_id })}
          onToggleDone={handleToggle}
        />
      )}

      {modal && (
        <GigFormModal
          mode={modal.mode}
          gigId={modal.gigId}
          onClose={handleClose}
        />
      )}
    </>
  )
}
