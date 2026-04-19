import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import TasksTable from '../components/TasksTable.jsx'
import GigFormModal from '../components/GigFormModal.jsx'
import { listAllTasks } from '../api/tasks.js'
import { updateTask } from '../api/gigs.js'

export default function TasksPage() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // null | { mode: 'edit', gigId: number }

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

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
          Tasks
        </Typography>
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
          tasks={tasks}
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
