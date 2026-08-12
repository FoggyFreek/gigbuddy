import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import AddIcon from '@mui/icons-material/Add'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import ContactsTable from './components/ContactsTable.tsx'
import ContactFormModal from './components/ContactFormModal.tsx'
import ContactImportDialog from './components/ContactImportDialog.tsx'
import SplitView from '../../components/SplitView.tsx'
import { listContacts } from './contacts.ts'
import { ALL_CONTACT_CATEGORIES, contactMatchesCategoryFilter } from './contactCategories.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import type { Contact } from '../../types/entities.ts'

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
  const [modal, setModal] = useState<{ mode: 'create' } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const { category, excludeCategory } = listFilter
  const activeFilter = useMemo(() => {
    const filters: ListFilter = {}
    if (category) filters.category = category
    if (excludeCategory) filters.excludeCategory = excludeCategory
    return filters
  }, [category, excludeCategory])

  // Contacts are tagged with the request they answered — the active filter plus
  // the reload counter — so `loading` and `error` are derived from whether the
  // newest request has landed rather than set synchronously when it starts.
  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])
  const contactsKey = `${JSON.stringify(activeFilter)}|${reloadNonce}`
  const [contactsState, setContactsState] = useState<{ key: string; contacts: Contact[]; error: string | null } | null>(null)
  const contacts = contactsState?.contacts ?? []
  const loading = contactsState?.key !== contactsKey
  const error = contactsState?.key === contactsKey ? contactsState.error : null

  useEffect(() => {
    let cancelled = false
    listContacts(activeFilter)
      .then((data) => {
        if (!cancelled) setContactsState({ key: contactsKey, contacts: data, error: null })
      })
      .catch((e) => {
        if (!cancelled) {
          setContactsState((prev) => ({
            key: contactsKey,
            contacts: prev?.contacts ?? [],
            error: e instanceof Error ? e.message : String(e),
          }))
        }
      })
    return () => { cancelled = true }
  }, [contactsKey, activeFilter])

  const handleContactUpdate = useCallback((id: number, patch: Partial<Contact>) => {
    setContactsState((prev) => (prev
      ? {
        ...prev,
        contacts: prev.contacts
          .map((c) => (c.id === id ? { ...c, ...patch } : c))
          .filter((c) => contactMatchesCategoryFilter(c, activeFilter)),
      }
      : prev))
  }, [activeFilter])

  const handleContactDelete = useCallback((id: number) => {
    setContactsState((prev) => (prev ? { ...prev, contacts: prev.contacts.filter((c) => c.id !== id) } : prev))
  }, [])

  function handleClose() {
    setModal(null)
    reload()
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
              <UploadFileIcon />
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
            if (reloaded) reload()
          }}
        />
      )}
    </SplitView>
  )
}
