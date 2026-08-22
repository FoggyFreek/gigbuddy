import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import TextField from '@mui/material/TextField'

interface Props {
  initialName: string
  onCancel: () => void
  onSave: (name: string) => Promise<void>
}

export default function VenueGroupNameDialogContent({ initialName, onCancel, onSave }: Readonly<Props>) {
  const { t } = useTranslation(['venues', 'common'])
  const [name, setName] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await onSave(name.trim())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setSaving(false)
    }
  }

  const valid = name.trim().length > 0
  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <TextField
        autoFocus
        fullWidth
        size="small"
        label={t($ => $.groups.name)}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && valid && !saving) void submit()
        }}
      />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 3 }}>
        <Button onClick={onCancel} disabled={saving}>{t($ => $.common.actions.cancel)}</Button>
        <Button variant="contained" onClick={() => { void submit() }} disabled={!valid || saving}>
          {saving ? <CircularProgress size={20} /> : t($ => $.common.actions.save)}
        </Button>
      </Box>
    </Box>
  )
}
