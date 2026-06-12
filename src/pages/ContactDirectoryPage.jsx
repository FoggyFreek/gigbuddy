import { useCallback, useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import ContactsTable from '../components/ContactsTable.jsx'
import ContactFormModal from '../components/ContactFormModal.jsx'
import ContactImportDialog from '../components/ContactImportDialog.jsx'
import SplitView from '../components/SplitView.jsx'
import { listContacts } from '../api/contacts.js'
import { ALL_CONTACT_CATEGORIES, contactMatchesCategoryFilter } from '../utils/contactCategories.js'

export default function ContactDirectoryPage({
  title,
  basePath,
  listFilter = {},
  categories = ALL_CONTACT_CATEGORIES,
  createInitial = {},
  createTitle = 'Add contact',
  createSubmitLabel = 'Add contact',
  allowImport = true,
  emptyMessage = 'No contacts yet - add one or import from CSV.',
}) {
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const { category, excludeCategory } = listFilter
  const activeFilter = useMemo(() => {
    const filters = {}
    if (category) filters.category = category
    if (excludeCategory) filters.excludeCategory = excludeCategory
    return filters
  }, [category, excludeCategory])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listContacts(activeFilter)
      setContacts(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [activeFilter])

  const handleContactUpdate = useCallback((id, patch) => {
    setContacts((prev) => {
      return prev
        .map((c) => (c.id === id ? { ...c, ...patch } : c))
        .filter((c) => contactMatchesCategoryFilter(c, activeFilter))
    })
  }, [activeFilter])

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
      basePath={basePath}
      outletContext={{
        basePath,
        contactFilter: activeFilter,
        onContactUpdate: handleContactUpdate,
        onContactDelete: handleContactDelete,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1 }}>
        <Typography variant="h5" fontWeight={600} sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        {allowImport && (
          <Tooltip title="Import">
            <IconButton onClick={() => setImportOpen(true)}>
              <FileUploadOutlinedIcon />
            </IconButton>
          </Tooltip>
        )}
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
          onRowClick={(c) => navigate(`${basePath}/${c.id}`)}
          selectedId={selectedId}
          categories={categories}
          emptyMessage={emptyMessage}
        />
      )}

      {modal && (
        <ContactFormModal
          mode="create"
          initial={createInitial}
          categories={categories}
          title={createTitle}
          submitLabel={createSubmitLabel}
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

ContactDirectoryPage.propTypes = {
  title: PropTypes.string.isRequired,
  basePath: PropTypes.string.isRequired,
  listFilter: PropTypes.shape({
    category: PropTypes.string,
    excludeCategory: PropTypes.string,
  }),
  categories: PropTypes.arrayOf(PropTypes.string),
  createInitial: PropTypes.shape({
    name: PropTypes.string,
    email: PropTypes.string,
    phone: PropTypes.string,
    category: PropTypes.string,
  }),
  createTitle: PropTypes.string,
  createSubmitLabel: PropTypes.string,
  allowImport: PropTypes.bool,
  emptyMessage: PropTypes.string,
}
