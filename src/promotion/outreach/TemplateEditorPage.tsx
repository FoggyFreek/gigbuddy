import { useCallback, useEffect, useRef, useState } from 'react'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import DeleteIcon from '@mui/icons-material/Delete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useDialog } from '../../contexts/dialogContext.ts'
import { useSetWideContent } from '../../contexts/contentWidthContext.ts'
import useDebouncedSave from '../../hooks/useDebouncedSave.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import SaveStatusLabel from '../../components/SaveStatusLabel.tsx'
import TemplateEditor, { type TemplateEditorRef } from './components/TemplateEditor.tsx'
import {
  deleteOutreachTemplate,
  getOutreachTemplate,
  listOutreachFields,
  listOutreachImages,
  updateOutreachTemplate,
  type OutreachField,
  type OutreachImageOption,
  type OutreachTemplate,
} from './outreachTemplates.ts'

type TemplatePatch = Partial<OutreachTemplate> & Record<string, unknown>

export default function TemplateEditorPage() {
  const { t } = useTranslation(['outreach', 'common'])
  const navigate = useNavigate()
  const { id } = useParams()
  const templateId = Number(id)
  const requestWide = useSetWideContent()
  const { confirmDelete } = useDialog()
  const { canWritePlanning } = usePermissions()
  const [template, setTemplate] = useState<OutreachTemplate | null>(null)
  const [fields, setFields] = useState<OutreachField[]>([])
  const [images, setImages] = useState<OutreachImageOption[]>([])
  const [loading, setLoading] = useState(true)
  const editorRef = useRef<TemplateEditorRef>(null)
  const saveFn = useCallback(async (patch: TemplatePatch) => {
    const serialized = await editorRef.current?.getSerializedContent()
    return updateOutreachTemplate(templateId, serialized ? { ...patch, ...serialized } : patch)
  }, [templateId])
  const { schedule, flush, status } = useDebouncedSave<TemplatePatch>(saveFn)
  const handleEditorUpdate = useCallback((value: Pick<OutreachTemplate, 'body_json'>) => {
    schedule(value)
  }, [schedule])

  useEffect(() => { requestWide(true); return () => requestWide(false) }, [requestWide])
  useEffect(() => {
    let cancelled = false
    getOutreachTemplate(templateId).then(async (value) => {
      const [nextFields, nextImages] = await Promise.all([
        listOutreachFields(value.locale, value.context),
        listOutreachImages(),
      ])
      if (!cancelled) { setTemplate(value); setFields(nextFields); setImages(nextImages) }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [templateId])

  if (loading || !template) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress /></Box>
  const canWrite = canWritePlanning

  function change(field: keyof OutreachTemplate, value: unknown) {
    if (!canWrite) return
    setTemplate((current) => current ? { ...current, [field]: value } : current)
    schedule({ [field]: value })
  }

  async function remove() {
    if (!canWrite || !await confirmDelete({ title: t($ => $.deleteTitle) })) return
    await deleteOutreachTemplate(templateId)
    navigate('/outreach/templates')
  }

  async function leaveEditor() {
    const bodyJson = editorRef.current?.getCurrentJson()
    if (bodyJson && canWrite) schedule({ body_json: bodyJson })
    await flush()
    navigate('/outreach/templates')
  }

  return <>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => { void leaveEditor() }}>{t($ => $.common.actions.back)}</Button>
      <Typography variant="h5" sx={{ flexGrow: 1, fontWeight: 600 }}>{template.name}</Typography>
      <SaveStatusLabel status={status} />
      {canWrite && <Button color="error" startIcon={<DeleteIcon />} onClick={() => { void remove() }}>{t($ => $.common.actions.delete)}</Button>}
    </Box>
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}><Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth label={t($ => $.editor.name)} value={template.name} disabled={!canWrite} onChange={(e) => change('name', e.target.value)} /></Grid>
      <Grid size={{ xs: 6, md: 3 }}><TextField select fullWidth label={t($ => $.editor.locale)} value={template.locale} disabled={!canWrite} onChange={async (e) => { const locale = e.target.value as 'nl' | 'en'; change('locale', locale); setFields(await listOutreachFields(locale, template.context)) }}><MenuItem value="nl">Nederlands</MenuItem><MenuItem value="en">English</MenuItem></TextField></Grid>
      <Grid size={12}><TextField fullWidth label={t($ => $.editor.subject)} value={template.subject} disabled={!canWrite} onChange={(e) => change('subject', e.target.value)} /></Grid>
    </Grid></Paper>
    <TemplateEditor
      ref={editorRef}
      content={template.body_json}
      fields={fields}
      images={images}
      locale={template.locale}
      previewSubject={template.subject}
      canWrite={canWrite}
      onUpdate={handleEditorUpdate}
    />
  </>
}
