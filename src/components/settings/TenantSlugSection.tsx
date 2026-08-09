import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import PremiumDiamond from '../PremiumDiamond.tsx'
import { FEATURES } from '../../auth/entitlements.ts'
import { updateActiveTenantSlug } from '../../api/tenants.ts'
import { useAuth } from '../../contexts/authContext.ts'
import { useEntitlements } from '../../hooks/useEntitlements.ts'
import { isApiError } from '../../types/api.ts'
import { validTenantSlug } from '../../utils/slugify.ts'

export default function TenantSlugSection() {
  const { t } = useTranslation('settings')
  const { user, refreshUser } = useAuth()
  const { has } = useEntitlements()
  const tenantId = user?.activeTenantId ?? null
  const membership = user?.memberships?.find((item) => item.tenantId === tenantId)
  const currentSlug = membership?.tenantSlug ?? ''
  const [savedSlug, setSavedSlug] = useState(currentSlug)
  const [slug, setSlug] = useState(currentSlug)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  if (!currentSlug) return null

  const entitled = has(FEATURES.CUSTOM_SLUG)
  const candidate = slug.trim()
  const valid = validTenantSlug(candidate)
  const canSave = entitled && valid && candidate !== savedSlug && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const result = await updateActiveTenantSlug(candidate)
      setSavedSlug(result.slug)
      setSlug(result.slug)
      await refreshUser().catch(() => undefined)
      setSuccess(true)
    } catch (caught) {
      if (isApiError(caught) && caught.code === 'slug_in_use') {
        setError(t($ => $.tenantSlug.errors.inUse))
      } else if (isApiError(caught) && caught.code === 'invalid_slug') {
        setError(t($ => $.tenantSlug.errors.invalid))
      } else {
        setError(t($ => $.tenantSlug.errors.failed))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.tenantSlug.title)}
        </Typography>
        <PremiumDiamond feature={FEATURES.CUSTOM_SLUG} />
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {t($ => $.tenantSlug.description)}
      </Typography>
      <Stack spacing={2}>
        <TextField
          fullWidth
          size="small"
          label={t($ => $.tenantSlug.label)}
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value)
            setError(null)
            setSuccess(false)
          }}
          disabled={!entitled || saving}
          error={candidate.length > 0 && !valid}
          helperText={t($ => $.tenantSlug.helper)}
          autoComplete="off"
          slotProps={{ htmlInput: { spellCheck: false } }}
        />
        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{t($ => $.tenantSlug.success)}</Alert>}
        <Button variant="contained" onClick={handleSave} disabled={!canSave} sx={{ alignSelf: 'flex-start' }}>
          {t($ => $.tenantSlug.save)}
        </Button>
      </Stack>
    </Paper>
  )
}
