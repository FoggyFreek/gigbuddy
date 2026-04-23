import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import DownloadIcon from '@mui/icons-material/Download'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import InsertLinkIcon from '@mui/icons-material/InsertLink'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { createEmailTemplate, getEmailTemplate, updateEmailTemplate } from '../api/emailTemplates.js'
import useDebouncedSave from '../hooks/useDebouncedSave.js'

const EMPTY_FORM = { name: '', subject: '' }

function downloadEml(name, subject, bodyHtml) {
  const content = [
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    `Subject: ${subject}`,
    '',
    bodyHtml,
  ].join('\r\n')
  const blob = new Blob([content], { type: 'message/rfc822' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/\s+/g, '_') || 'template'}.eml`
  a.click()
  URL.revokeObjectURL(url)
}

function ToolbarButton({ title, onClick, active, children }) {
  return (
    <Tooltip title={title}>
      <IconButton
        size="small"
        onMouseDown={(e) => { e.preventDefault(); onClick() }}
        color={active ? 'primary' : 'default'}
        sx={{ borderRadius: 1 }}
      >
        {children}
      </IconButton>
    </Tooltip>
  )
}

function EditorToolbar({ editor }) {
  if (!editor) return null

  function handleLink() {
    const prev = editor.getAttributes('link').href || ''
    const url = window.prompt('URL', prev)
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
    } else {
      editor.chain().focus().setLink({ href: url }).run()
    }
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 0.25,
        p: 0.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.default',
      }}
    >
      <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <FormatBoldIcon fontSize="small" />
      </ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <FormatItalicIcon fontSize="small" />
      </ToolbarButton>
      <ToolbarButton title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <FormatUnderlinedIcon fontSize="small" />
      </ToolbarButton>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
      <ToolbarButton title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Typography variant="caption" fontWeight={700} sx={{ lineHeight: 1, px: 0.25 }}>H2</Typography>
      </ToolbarButton>
      <ToolbarButton title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Typography variant="caption" fontWeight={700} sx={{ lineHeight: 1, px: 0.25 }}>H3</Typography>
      </ToolbarButton>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
      <ToolbarButton title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <FormatListBulletedIcon fontSize="small" />
      </ToolbarButton>
      <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <FormatListNumberedIcon fontSize="small" />
      </ToolbarButton>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
      <ToolbarButton title="Link" active={editor.isActive('link')} onClick={handleLink}>
        <InsertLinkIcon fontSize="small" />
      </ToolbarButton>
    </Box>
  )
}

export default function EmailTemplateFormModal({ mode, templateId, onClose }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(mode === 'edit')

  const saveFn = useCallback(
    async (patch) => { await updateEmailTemplate(templateId, patch) },
    [templateId]
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: '',
    onUpdate({ editor: e }) {
      if (mode === 'edit') {
        schedule({ body_html: e.getHTML() })
      }
    },
  })

  useEffect(() => {
    if (mode !== 'edit' || !editor) return
    getEmailTemplate(templateId)
      .then((t) => {
        setForm({ name: t.name || '', subject: t.subject || '' })
        editor.commands.setContent(t.body_html || '')
      })
      .finally(() => setLoading(false))
  }, [mode, templateId, editor])

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    if (mode === 'edit') schedule({ [field]: value })
  }

  async function handleCreate() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Required'
    if (Object.keys(errs).length) { setErrors(errs); return }
    await createEmailTemplate({
      name: form.name.trim(),
      subject: form.subject,
      body_html: editor ? editor.getHTML() : '',
    })
    onClose()
  }

  async function handleClose() {
    await flush()
    onClose()
  }

  const saveLabel = {
    idle: '',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Save failed',
  }[saveStatus]
  const saveColor = saveStatus === 'error' ? 'error.main' : 'text.secondary'

  return (
    <Dialog open fullWidth maxWidth="md" onClose={mode === 'edit' ? handleClose : undefined}>
      <DialogTitle>
        {mode === 'create' ? 'New email template' : 'Edit email template'}
      </DialogTitle>

      {loading ? (
        <DialogContent sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </DialogContent>
      ) : (
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={12}>
              <TextField
                label="Template name"
                fullWidth
                required
                value={form.name}
                onChange={(e) => handleChange('name', e.target.value)}
                error={!!errors.name}
                helperText={errors.name}
                placeholder="e.g. Gig announcement, Rehearsal notice"
              />
            </Grid>
            <Grid size={12}>
              <TextField
                label="Subject"
                fullWidth
                value={form.subject}
                onChange={(e) => handleChange('subject', e.target.value)}
                placeholder="e.g. We're playing at The Venue on Friday!"
              />
            </Grid>
            <Grid size={12}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                Body
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  '& .ProseMirror': {
                    minHeight: 220,
                    p: 1.5,
                    outline: 'none',
                    fontSize: '0.875rem',
                    lineHeight: 1.6,
                    '& p': { m: 0, mb: 1 },
                    '& h2': { fontSize: '1.25rem', fontWeight: 700, mt: 1.5, mb: 0.5 },
                    '& h3': { fontSize: '1rem', fontWeight: 700, mt: 1, mb: 0.5 },
                    '& ul, & ol': { pl: 3, mb: 1 },
                    '& a': { color: 'primary.main' },
                    '& p.is-editor-empty:first-of-type::before': {
                      color: 'text.disabled',
                      content: 'attr(data-placeholder)',
                      float: 'left',
                      height: 0,
                      pointerEvents: 'none',
                    },
                  },
                }}
              >
                <EditorToolbar editor={editor} />
                <EditorContent editor={editor} />
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>
      )}

      <Box sx={{ px: 3, pb: 1, minHeight: 24 }}>
        {mode === 'edit' && (
          <Typography variant="caption" color={saveColor}>
            {saveLabel}
          </Typography>
        )}
      </Box>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {mode === 'create' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" onClick={handleCreate}>Save template</Button>
          </>
        ) : (
          <>
            <Button
              startIcon={<DownloadIcon />}
              onClick={() => downloadEml(form.name, form.subject, editor ? editor.getHTML() : '')}
            >
              Download .eml
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button variant="contained" onClick={handleClose}>Close</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
