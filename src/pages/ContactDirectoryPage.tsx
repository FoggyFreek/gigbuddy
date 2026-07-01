import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import ContactsTable from '../components/ContactsTable.tsx'
import ContactFormModal from '../components/ContactFormModal.tsx'
import ContactImportDialog from '../components/ContactImportDialog.tsx'
import SplitView from '../components/SplitView.tsx'
import { listContacts } from '../api/contacts.ts'
import { ALL_CONTACT_CATEGORIES, contactMatchesCategoryFilter } from '../utils/contactCategories.ts'
import { usePermissions } from '../hooks/usePermissions.ts'
import type { Contact } from '../types/entities.ts'

interface ListFilter {
  category?: string
  excludeCategory?: string
}

interface ContactDirectoryPageProps {
  title: string
  basePath: string
  listFilter?: ListFilter
  categories?: string[]
  createInitial?: Partial<Contact>
  createTitle?: string
  createSubmitLabel?: string
  allowImport?: boolean
  emptyMessage?: string
  importTitle?: string
}

export default function ContactDirectoryPage({
  title,
  basePath,
  listFilter = {},
  categories = ALL_CONTACT_CATEGORIES,
  createInitial = {},
  createTitle,
  createSubmitLabel,
  allowImport = true,
  emptyMessage,
  importTitle,
}: Readonly<ContactDirectoryPageProps>) {
  const { t } = useTranslation(['contacts', 'common'])
  const resolvedCreateTitle = createTitle ?? t($ => $.addContact)
  const resolvedSubmitLabel = createSubmitLabel ?? t($ => $.addContact)
  const resolvedEmptyMessage = emptyMessage ?? t($ => $.empty)
  const resolvedImportTitle = importTitle ?? t($ => $.importTitle)
  const { canWritePlanning } = usePermissions()
  const navigate = useNavigate()
  const { id: selectedIdParam } = useParams()
  const selectedId = selectedIdParam ? Number(selectedIdParam) : null
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const { category, excludeCategory } = listFilter
  const activeFilter = useMemo(() => {
    const filters: ListFilter = {}
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
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [activeFilter])

  const handleContactUpdate = useCallback((id: number, patch: Partial<Contact>) => {
    setContacts((prev) => {
      return prev
        .map((c) => (c.id === id ? { ...c, ...patch } : c))
        .filter((c) => contactMatchesCategoryFilter(c, activeFilter))
    })
  }, [activeFilter])

  const handleContactDelete = useCallback((id: number) => {
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
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {title}
        </Typography>
        {allowImport && canWritePlanning && (
          <Tooltip title={t($ => $.importTooltip)}>
            <IconButton onClick={() => setImportOpen(true)}>
              <FileUploadOutlinedIcon />
            </IconButton>
          </Tooltip>
        )}
        {canWritePlanning && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setModal({ mode: 'create' })}
          >
            {t($ => $.common.actions.add)}
          </Button>
        )}
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
          selectedId={selectedId ?? undefined}
          categories={categories}
          emptyMessage={resolvedEmptyMessage}
        />
      )}

      {modal && (
        <ContactFormModal
          mode="create"
          initial={createInitial}
          categories={categories}
          title={resolvedCreateTitle}
          submitLabel={resolvedSubmitLabel}
          onClose={handleClose}
        />
      )}

      {importOpen && (
        <ContactImportDialog
          fixedCategory={category}
          title={resolvedImportTitle}
          onClose={(reloaded) => {
            setImportOpen(false)
            if (reloaded) load()
          }}
        />
      )}
    </SplitView>
  )
}
