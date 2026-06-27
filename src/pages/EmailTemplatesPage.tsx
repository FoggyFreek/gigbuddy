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
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await listEmailTemplates()
      setTemplates(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleClose() {
    setModal(null)
    load()
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
