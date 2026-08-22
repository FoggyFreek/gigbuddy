import { useState } from 'react'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { useTenantKind } from '../../../hooks/useTenantKind.ts'
import { createOutreachTemplate, type OutreachTemplate } from '../outreachTemplates.ts'
import { OUTREACH_DEFAULTS } from '../defaults/index.ts'

interface Props { onClose: () => void; onCreated: (template: OutreachTemplate) => void }

function textFromDoc(value: unknown): string {
  if (Array.isArray(value)) return value.map(textFromDoc).join('')
  if (!value || typeof value !== 'object') return ''
  const node = value as { text?: unknown; content?: unknown }
  return typeof node.text === 'string' ? node.text : textFromDoc(node.content)
}

function initialRenderedBody(doc: Record<string, unknown> | undefined) {
  const text = doc ? textFromDoc(doc) : ''
  const html = text ? `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>` : ''
  return { html, text }
}

export default function CreateTemplateDialog({ onClose, onCreated }: Readonly<Props>) {
  const { t } = useTranslation(['outreach', 'common'])
  const { kind: tenantKind } = useTenantKind()
  const [name, setName] = useState('')
  const [defaultKey, setDefaultKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const defaults = OUTREACH_DEFAULTS.filter((entry) => entry.tenantKinds.includes(tenantKind))

  async function create() {
    if (!name.trim()) { setError(t($ => $.create.nameRequired)); return }
    setBusy(true); setError(null)
    try {
      const selected = OUTREACH_DEFAULTS.find((entry) => entry.key === defaultKey)
      const rendered = selected?.bodyHtml === undefined
        ? initialRenderedBody(selected?.doc)
        : { html: selected.bodyHtml, text: selected.bodyText ?? '' }
      const template = await createOutreachTemplate({
        name: name.trim(), subject: selected?.subject ?? '', preview_text: null,
        body_json: selected?.doc ?? {}, body_html: rendered.html, body_text: rendered.text,
        origin_key: selected?.key ?? null, locale: selected?.locale ?? 'nl',
      })
      onCreated(template)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setBusy(false) }
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={busy ? undefined : onClose}>
      <DialogTitle>{t($ => $.create.title)}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
        <TextField label={t($ => $.create.name)} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <Select displayEmpty value={defaultKey} onChange={(e) => setDefaultKey(e.target.value)} inputProps={{ 'aria-label': t($ => $.create.startingPoint) }}>
          <MenuItem value="">{t($ => $.create.blank)}</MenuItem>{defaults.map((entry) => <MenuItem key={entry.key} value={entry.key}>{entry.label}</MenuItem>)}
        </Select>
        {error && <Typography variant="body2" sx={{ color: 'error.main' }}>{error}</Typography>}
      </Stack></DialogContent>
      <DialogActions><Button onClick={onClose} disabled={busy}>{t($ => $.common.actions.cancel)}</Button><Button variant="contained" onClick={() => { void create() }} disabled={busy}>{t($ => $.create.button)}</Button></DialogActions>
    </Dialog>
  )
}
