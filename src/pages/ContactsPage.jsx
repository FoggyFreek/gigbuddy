import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import ContactsTable from '../components/ContactsTable.jsx'
import ContactFormModal from '../components/ContactFormModal.jsx'
import ContactImportDialog from '../components/ContactImportDialog.jsx'
import SplitView from '../components/SplitView.jsx'
import { listContacts } from '../api/contacts.js'
import Tooltip from '@mui/material/Tooltip'

export default function ContactsPage() {
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // null | { mode: 'create' }
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listContacts()
      setContacts(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleContactUpdate = useCallback((id, patch) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  const handleContactDelete = useCallback((id) => {
    setContacts((prev) => prev.filter((c) => c.id !== id))
  }, [])

  useEffect(() => { load() }, [load])

  function handleClose() {
    setModal(null)
    load()
  }

  return (
    <SplitView
      basePath="/contacts"
      outletContext={{ onContactUpdate: handleContactUpdate, onContactDelete: handleContactDelete }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
          Contacts
        </Typography>
        <Tooltip title="Import">
          <IconButton onClick={() => setImportOpen(true)}>
            <FileUploadOutlinedIcon />
          </IconButton>
        </Tooltip>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setModal({ mode: 'create' })}
        >
          Add
        </Button>
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
        <ContactsTable
          contacts={contacts}
          onRowClick={(c) => navigate(`/contacts/${c.id}`)}
          selectedId={selectedId}
        />
      )}

      {modal && (
        <ContactFormModal
          mode="create"
          onClose={handleClose}
        />
      )}

      {importOpen && (
        <ContactImportDialog
          onClose={(reloaded) => {
            setImportOpen(false)
            if (reloaded) load()
          }}
        />
      )}
    </SplitView>
  )
}
