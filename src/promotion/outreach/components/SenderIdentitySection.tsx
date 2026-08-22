import { useEffect, useState } from 'react'
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import { getOutreachSender, saveOutreachSender } from '../outreachSender.ts'

export default function SenderIdentitySection() {
  const { t } = useTranslation('settings')
  const [form, setForm] = useState({ fromName: '', fromEmail: '', replyTo: '' })
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void getOutreachSender().then((sender) => {
      if (!cancelled) {
        setForm({ fromName: sender.fromName ?? '', fromEmail: sender.fromEmail ?? '', replyTo: sender.replyTo ?? '' })
        setSaved(sender.configured)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  function change(key: keyof typeof form, value: string) { setForm((current) => ({ ...current, [key]: value })); setSaved(false) }
  async function save() {
    setSaving(true); setError(null)
    try {
      const sender = await saveOutreachSender({ ...form, replyTo: form.replyTo || null })
      setSaved(sender.configured)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) } finally { setSaving(false) }
  }
  return <Box>
    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{t($ => $.resend.sender.title)}</Typography>
    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>{t($ => $.resend.sender.description)}</Typography>
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <TextField fullWidth size="small" label={t($ => $.resend.sender.fromName)} value={form.fromName} onChange={(e) => change('fromName', e.target.value)} />
      <TextField fullWidth size="small" label={t($ => $.resend.sender.fromEmail)} type="email" value={form.fromEmail} onChange={(e) => change('fromEmail', e.target.value)} />
      <TextField fullWidth size="small" label={t($ => $.resend.sender.replyTo)} type="email" value={form.replyTo} onChange={(e) => change('replyTo', e.target.value)} />
      <Tooltip title={t($ => $.resend.sender.save)}>
        <span>
          <IconButton
            color="primary"
            aria-label={t($ => $.resend.sender.save)}
            onClick={() => { void save() }}
            disabled={saving}
          >
            {saving ? <CircularProgress size={20} /> : <MarkEmailReadIcon />}
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
    <Stack spacing={1} sx={{ mt: saved || error ? 1.5 : 0 }}>
      {saved && <Alert severity="success">{t($ => $.resend.sender.saved)}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  </Box>
}
