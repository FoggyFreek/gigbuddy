import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import EmailTemplatesTable from '../components/EmailTemplatesTable.tsx'
import EmailTemplateFormModal from '../components/EmailTemplateFormModal.tsx'
import { listEmailTemplates } from '../api/emailTemplates.ts'
import type { Id } from '../types/entities.ts'

interface EmailTemplate {
  id?: Id
  name?: string
  subject?: string
  body_html?: string
  event_type?: string
}

type ModalState = { mode: 'create' } | { mode: 'edit'; templateId: Id } | null

export default function EmailTemplatesPage() {
  const { t } = useTranslation(['emailTemplates', 'common'])
  const [modal, setModal] = useState<ModalState>(null)

  // The fetched list is tagged with the reload it answered, so `loading` and
  // `error` are derived from whether the newest reload has landed.
  const [reloadNonce, setReloadNonce] = useState(0)
  const reload = useCallback(() => setReloadNonce((n) => n + 1), [])
  const [templatesState, setTemplatesState] = useState<{ key: number; templates: EmailTemplate[]; error: string | null } | null>(null)
  const templates = templatesState?.templates ?? []
  const loading = templatesState?.key !== reloadNonce
  const error = templatesState?.key === reloadNonce ? templatesState.error : null

  useEffect(() => {
    let cancelled = false
    listEmailTemplates()
      .then((data) => {
        if (!cancelled) setTemplatesState({ key: reloadNonce, templates: data, error: null })
      })
      .catch((e) => {
        if (!cancelled) {
          setTemplatesState((prev) => ({
            key: reloadNonce,
            templates: prev?.templates ?? [],
            error: e instanceof Error ? e.message : String(e),
          }))
        }
      })
    return () => { cancelled = true }
  }, [reloadNonce])

  function handleClose() {
    setModal(null)
    reload()
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {t($ => $.title)}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setModal({ mode: 'create' })}
        >
          {t($ => $.common.actions.add)}
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
        <EmailTemplatesTable
          templates={templates}
          onRowClick={(t) => t.id != null && setModal({ mode: 'edit', templateId: t.id })}
        />
      )}

      {modal && (
        <EmailTemplateFormModal
          mode={modal.mode}
          templateId={modal.mode === 'edit' ? modal.templateId : undefined}
          onClose={handleClose}
        />
      )}
    </>
  )
}
