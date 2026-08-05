import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import PremiumDiamond from '../PremiumDiamond.tsx'
import { useThemeMode } from '../../contexts/themeModeContext.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { useTenantKind } from '../../hooks/useTenantKind.ts'
import { clearMollieKey, getMollieKey, setMollieKey, clearResendKey, getResendKey, setResendKey, clearBandsintownKey, getBandsintownKey, setBandsintownKey, clearBandsintownArtistId, getBandsintownArtistId, setBandsintownArtistId, clearShopifySecret, getShopifySecret, setShopifySecret, getShopifyClientId, setShopifyClientId, clearShopifyClientId, getShopifyDomain, setShopifyDomain } from '../../api/profile.ts'
import type { IntegrationSecretStatus } from '../../api/profile.ts'
import Divider from '@mui/material/Divider'
import { useProfile } from '../../contexts/profileContext.ts'
import type { IntegrationName } from '../../utils/integrations.ts'

// Shopify client ids aren't secret but are long; collapse the middle so the
// display value doesn't eat the card's horizontal space.
function shortenClientId(value: string): string {
  if (value.length <= 14) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

// Renders the Integrations heading (with premium diamond) plus every
// third-party integration card. Tenant-admin gated by the settings page.
export default function IntegrationsSection() {
  const { t } = useTranslation('settings')
  const compact = useCompactLayout()
  // Shopify backs the band's merch shop and Bandsintown lists a band's tour
  // dates — neither has a personal-workspace counterpart. Mollie does: a solo
  // artist takes payment on their own invoices exactly like a band.
  const { isPersonal } = useTenantKind()

  return (
     <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.integrations.title)}
        </Typography>
        <PremiumDiamond feature="integrations" />
      </Stack>
      <ResendKeySection />
      <MollieKeySection />
      {!isPersonal && (
        <>
          <ShopifyKeySection />
          <BandsintownKeySection />
        </>
      )}
    </Paper>
  )
}

// Wraps a third-party integration's settings. Until something is configured the
// card collapses to just the logo + an "Add integration" button; configuring (or
// clicking the button) expands the full editor. Keeps the Integrations list tidy.
interface IntegrationCardProps {
  logoLight: string
  logoDark: string
  alt: string
  title: string
  description: string
  configured: boolean
  mt?: number
  children: React.ReactNode
}

function IntegrationCard({ logoLight, logoDark, alt, title, description, configured, mt = 2, children }: Readonly<IntegrationCardProps>) {
  const { t } = useTranslation('settings')
  const { mode } = useThemeMode()
  const compact = useCompactLayout()
  const [manuallyExpanded, setManuallyExpanded] = useState(false)
  // Expanded when already configured, or once the user opts in via the button.
  const expanded = manuallyExpanded || configured

  const logo = (
    <Box
      component="img"
      src={mode === 'dark' ? logoDark : logoLight}
      alt={alt}
      sx={{ height: 20, width: 'auto' }}
    />
  )

  if (!expanded) {
    return (
      <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3, mt }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1, display: 'flex' }}>{logo}</Box>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setManuallyExpanded(true)}>
            {t($ => $.integrations.add)}
          </Button>
        </Stack>
      </Paper>
    )
  }

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3, mt }}>
      <Stack direction="column" spacing={0.5} sx={{ mb: 0.5 }}>
        <Box sx={{ alignSelf: 'flex-start', display: 'flex' }}>{logo}</Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{description}</Typography>
      {children}
    </Paper>
  )
}

interface ShopifyKeyStatus {
  isSet?: boolean
  changedAt?: string | null
}

interface ShopifyClientIdBlockProps {
  clientId: string
  savedClientId: string | null
  editing: boolean
  saving: boolean
  error: string | null
  onChange: (value: string) => void
  onStartEdit: () => void
  onCancel: () => void
  onSave: () => void
  onClear: () => void
}

function ShopifyClientIdBlock({ clientId, savedClientId, editing, saving, error, onChange, onStartEdit, onCancel, onSave, onClear }: Readonly<ShopifyClientIdBlockProps>) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t($ => $.shopify.clientId.label)}
      </Typography>
      {editing ? (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          <TextField
            label={t($ => $.shopify.clientId.label)}
            fullWidth
            size="small"
            value={clientId}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t($ => $.shopify.clientId.placeholder)}
            error={!!error}
            helperText={error || t($ => $.shopify.clientId.helper)}
            autoComplete="off"
            slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'none' } }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="small"
              onClick={onSave}
              disabled={!clientId.trim() || saving}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : null}
            >
              {t($ => $.actions.save, { ns: 'common' })}
            </Button>
            <Button size="small" onClick={onCancel} disabled={saving}>
              {t($ => $.actions.cancel, { ns: 'common' })}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 3 }}>
          <Box sx={{ flex: 1 }}>
            {savedClientId ? (
              <Tooltip title={savedClientId}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                  {shortenClientId(savedClientId)}
                </Typography>
              </Tooltip>
            ) : (
              <Typography variant="body2" color="text.disabled">{t($ => $.integrations.notConfigured)}</Typography>
            )}
          </Box>
          <Button size="small" variant="outlined" onClick={onStartEdit} disabled={saving}>
            {savedClientId ? t($ => $.shopify.clientId.replace) : t($ => $.integrations.configure)}
          </Button>
          {savedClientId && (
            <Tooltip title={t($ => $.shopify.clientId.remove)}>
              <span>
                <IconButton size="small" color="error" onClick={onClear} disabled={saving}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      )}
    </>
  )
}

interface ShopifySecretBlockProps {
  status: ShopifyKeyStatus | null
  inputKey: string
  editing: boolean
  showKey: boolean
  saving: boolean
  error: string | null
  onChange: (value: string) => void
  onToggleShowKey: () => void
  onStartEdit: () => void
  onCancel: () => void
  onSave: () => void
  onClear: () => void
}

function ShopifySecretBlock({ status, inputKey, editing, showKey, saving, error, onChange, onToggleShowKey, onStartEdit, onCancel, onSave, onClear }: Readonly<ShopifySecretBlockProps>) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t($ => $.shopify.secret.label)}
      </Typography>
      {editing ? (
        <Stack spacing={1.5}>
          <TextField
            label={t($ => $.shopify.secret.label)}
            fullWidth
            size="small"
            value={inputKey}
            onChange={(e) => onChange(e.target.value)}
            type={showKey ? 'text' : 'password'}
            placeholder={t($ => $.shopify.secret.placeholder)}
            error={!!error}
            helperText={error || t($ => $.shopify.secret.helper)}
            autoComplete="off"
            slotProps={{
              htmlInput: { spellCheck: false },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={onToggleShowKey}
                      edge="end"
                      aria-label={showKey ? t($ => $.integrations.hideKey) : t($ => $.integrations.showKey)}
                    >
                      {showKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="small"
              onClick={onSave}
              disabled={!inputKey.trim() || saving}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : null}
            >
              {t($ => $.actions.save, { ns: 'common' })}
            </Button>
            <Button size="small" onClick={onCancel} disabled={saving}>
              {t($ => $.actions.cancel, { ns: 'common' })}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <KeyStatusDisplay status={status} />
          </Box>
          <Button size="small" variant="outlined" onClick={onStartEdit} disabled={saving}>
            {status?.isSet ? t($ => $.shopify.secret.replace) : t($ => $.integrations.configure)}
          </Button>
          {status?.isSet && (
            <Tooltip title={t($ => $.shopify.secret.remove)}>
              <span>
                <IconButton size="small" color="error" onClick={onClear} disabled={saving}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      )}
    </>
  )
}

interface ShopifyDomainBlockProps {
  domain: string
  savedDomain: string | null
  saving: boolean
  error: string | null
  onChange: (value: string) => void
  onSave: () => void
}

function ShopifyDomainBlock({ domain, savedDomain, saving, error, onChange, onSave }: Readonly<ShopifyDomainBlockProps>) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t($ => $.shopify.domain.label)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t($ => $.shopify.domain.description)}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          size="small"
          fullWidth
          value={domain}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t($ => $.shopify.domain.placeholder)}
          error={!!error}
          helperText={error || undefined}
          autoComplete="off"
          slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'none' } }}
        />
        <Button
          variant="outlined"
          size="small"
          onClick={onSave}
          disabled={saving || !domain.trim() || domain.trim() === savedDomain}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : null}
        >
          {t($ => $.actions.save, { ns: 'common' })}
        </Button>
      </Stack>
    </Box>
  )
}

export function ShopifyKeySection() {
  const { t } = useTranslation(['settings', 'common'])
  const { setIntegrationConfigured } = useProfile()
  const [status, setStatus] = useState<ShopifyKeyStatus | null>(null)
  const [editing, setEditing] = useState(false)
  const [inputKey, setInputKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [domain, setDomainInput] = useState('')
  const [savedDomain, setSavedDomain] = useState<string | null>(null)
  const [domainSaving, setDomainSaving] = useState(false)
  const [domainError, setDomainError] = useState<string | null>(null)

  const [clientId, setClientIdInput] = useState('')
  const [savedClientId, setSavedClientId] = useState<string | null>(null)
  const [clientIdEditing, setClientIdEditing] = useState(false)
  const [clientIdSaving, setClientIdSaving] = useState(false)
  const [clientIdError, setClientIdError] = useState<string | null>(null)

  useEffect(() => {
    getShopifySecret().then((s) => setStatus(s as unknown as ShopifyKeyStatus)).catch(() => {})
    getShopifyDomain().then((d) => {
      setSavedDomain(d.domain ?? null)
      setDomainInput(d.domain ?? '')
    }).catch(() => {})
    getShopifyClientId().then((c) => {
      setSavedClientId(c.clientId ?? null)
      setClientIdInput(c.clientId ?? '')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (status === null) return
    setIntegrationConfigured('shopify', Boolean(status.isSet && savedDomain && savedClientId))
  }, [savedClientId, savedDomain, setIntegrationConfigured, status])

  async function handleSaveDomain() {
    const trimmed = domain.trim()
    if (!trimmed) return
    setDomainSaving(true)
    setDomainError(null)
    try {
      const result = await setShopifyDomain(trimmed)
      setSavedDomain(result.domain ?? null)
      setDomainInput(result.domain ?? '')
    } catch {
      setDomainError(t($ => $.shopify.domain.error))
    } finally {
      setDomainSaving(false)
    }
  }

  function startEditingClientId() {
    setClientIdInput('')
    setClientIdError(null)
    setClientIdEditing(true)
  }

  function cancelEditingClientId() {
    setClientIdEditing(false)
    setClientIdInput('')
    setClientIdError(null)
  }

  async function handleSaveClientId() {
    const trimmed = clientId.trim()
    if (!trimmed) return
    setClientIdSaving(true)
    setClientIdError(null)
    try {
      const result = await setShopifyClientId(trimmed)
      setSavedClientId(result.clientId ?? null)
      setClientIdInput('')
      setClientIdEditing(false)
    } catch {
      setClientIdError(t($ => $.shopify.clientId.error))
    } finally {
      setClientIdSaving(false)
    }
  }

  async function handleClearClientId() {
    setClientIdSaving(true)
    try {
      await clearShopifyClientId()
      setSavedClientId(null)
      setClientIdInput('')
      setClientIdEditing(false)
    } finally {
      setClientIdSaving(false)
    }
  }

  function startEditing() {
    setInputKey('')
    setShowKey(false)
    setError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setInputKey('')
    setError(null)
  }

  async function handleSave() {
    if (!inputKey.trim()) return
    setSaving(true)
    setError(null)
    try {
      const result = await setShopifySecret(inputKey.trim())
      setStatus(result as unknown as ShopifyKeyStatus)
      setEditing(false)
      setInputKey('')
    } catch (err: unknown) {
      setError(err instanceof Error && err.message === 'invalid_shopify_client_secret'
        ? t($ => $.shopify.secret.invalidFormat)
        : t($ => $.shopify.secret.saveFailed))
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    try {
      const result = await clearShopifySecret()
      setStatus(result as unknown as ShopifyKeyStatus)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const configured = !!(savedClientId || status?.isSet || savedDomain)

  return (
    <IntegrationCard
      logoLight="/share/shopify/shopify_logo_black.png"
      logoDark="/share/shopify/shopify_logo_white.png"
      alt="Shopify"
      title={t($ => $.shopify.title)}
      description={t($ => $.shopify.description)}
      configured={configured}
      mt={2}
    >
      <ShopifyClientIdBlock
        clientId={clientId}
        savedClientId={savedClientId}
        editing={clientIdEditing}
        saving={clientIdSaving}
        error={clientIdError}
        onChange={(value) => { setClientIdInput(value); setClientIdError(null) }}
        onStartEdit={startEditingClientId}
        onCancel={cancelEditingClientId}
        onSave={handleSaveClientId}
        onClear={handleClearClientId}
      />
      <ShopifySecretBlock
        status={status}
        inputKey={inputKey}
        editing={editing}
        showKey={showKey}
        saving={saving}
        error={error}
        onChange={(value) => { setInputKey(value); setError(null) }}
        onToggleShowKey={() => setShowKey((v) => !v)}
        onStartEdit={startEditing}
        onCancel={cancelEditing}
        onSave={handleSave}
        onClear={handleClear}
      />
      <ShopifyDomainBlock
        domain={domain}
        savedDomain={savedDomain}
        saving={domainSaving}
        error={domainError}
        onChange={(value) => { setDomainInput(value); setDomainError(null) }}
        onSave={handleSaveDomain}
      />
    </IntegrationCard>
  )
}

interface MollieKeyStatus {
  isSet?: boolean
  changedAt?: string | null
}

// Shared by the Mollie, Bandsintown, and Shopify-secret blocks.
function KeyStatusDisplay({ status }: Readonly<{ status: MollieKeyStatus | null }>) {
  const { t } = useTranslation('settings')
  if (status === null) return <CircularProgress size={18} />
  if (status.isSet) {
    return (
      <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
        {t($ => $.integrations.configured)}
      </Typography>
    )
  }
  return <Typography variant="body2" color="text.disabled">{t($ => $.integrations.notConfigured)}</Typography>
}

interface SecretKeyEditorProps {
  inputKey: string
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  showKey?: boolean
  onToggleShowKey: () => void
  error?: string | null
  saving?: boolean
  onSave: () => void
  onCancel: () => void
  label: string
  placeholder: string
  helper: string
}

function SecretKeyEditor({ inputKey, onInputChange, showKey, onToggleShowKey, error, saving, onSave, onCancel, label, placeholder, helper }: Readonly<SecretKeyEditorProps>) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <Stack spacing={1.5}>
      <TextField
        label={label}
        fullWidth
        size="small"
        value={inputKey}
        onChange={onInputChange}
        type={showKey ? 'text' : 'password'}
        placeholder={placeholder}
        error={!!error}
        helperText={error || helper}
        autoComplete="off"
        slotProps={{
          htmlInput: { spellCheck: false },
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={onToggleShowKey}
                  edge="end"
                  aria-label={showKey ? t($ => $.integrations.hideKey) : t($ => $.integrations.showKey)}
                >
                  {showKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          size="small"
          onClick={onSave}
          disabled={!inputKey.trim() || saving}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : null}
        >
          {t($ => $.actions.save, { ns: 'common' })}
        </Button>
        <Button size="small" onClick={onCancel} disabled={saving}>
          {t($ => $.actions.cancel, { ns: 'common' })}
        </Button>
      </Stack>
    </Stack>
  )
}

interface SecretKeySectionProps {
  integration: IntegrationName
  api: {
    get: () => Promise<IntegrationSecretStatus>
    set: (key: string) => Promise<IntegrationSecretStatus>
    clear: () => Promise<IntegrationSecretStatus>
  }
  invalidCode: string
  logoLight: string
  logoDark: string
  alt: string
  copy: {
    title: string
    description: string
    label: string
    placeholder: string
    helper: string
    invalidFormat: string
    saveFailed: string
    replace: string
    remove: string
  }
  mt?: number
}

function SecretKeySection({ integration, api, invalidCode, logoLight, logoDark, alt, copy, mt }: Readonly<SecretKeySectionProps>) {
  const { t } = useTranslation('settings')
  const { setIntegrationConfigured } = useProfile()
  const [status, setStatus] = useState<IntegrationSecretStatus | null>(null)
  const [editing, setEditing] = useState(false)
  const [inputKey, setInputKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { get, set, clear } = api

  useEffect(() => {
    get().then(setStatus).catch(() => {})
  }, [get])

  useEffect(() => {
    if (status !== null) setIntegrationConfigured(integration, status.isSet)
  }, [integration, setIntegrationConfigured, status])

  function startEditing() {
    setInputKey('')
    setShowKey(false)
    setError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setEditing(false)
    setInputKey('')
    setError(null)
  }

  async function handleSave() {
    if (!inputKey.trim()) return
    setSaving(true)
    setError(null)
    try {
      const result = await set(inputKey.trim())
      setStatus(result)
      setEditing(false)
      setInputKey('')
    } catch (err: unknown) {
      setError(err instanceof Error && err.message === invalidCode
        ? copy.invalidFormat
        : copy.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    try {
      const result = await clear()
      setStatus(result)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <IntegrationCard
      logoLight={logoLight}
      logoDark={logoDark}
      alt={alt}
      title={copy.title}
      description={copy.description}
      configured={Boolean(status?.isSet)}
      mt={mt}
    >
      {editing ? (
        <SecretKeyEditor
          inputKey={inputKey}
          onInputChange={(e) => { setInputKey(e.target.value); setError(null) }}
          showKey={showKey}
          onToggleShowKey={() => setShowKey((value) => !value)}
          error={error}
          saving={saving}
          onSave={handleSave}
          onCancel={cancelEditing}
          label={copy.label}
          placeholder={copy.placeholder}
          helper={copy.helper}
        />
      ) : (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <KeyStatusDisplay status={status} />
          </Box>
          <Button size="small" variant="outlined" onClick={startEditing} disabled={saving}>
            {status?.isSet ? copy.replace : t($ => $.integrations.configure)}
          </Button>
          {status?.isSet && (
            <Tooltip title={copy.remove}>
              <span>
                <IconButton size="small" color="error" onClick={handleClear} disabled={saving} aria-label={copy.remove}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      )}
    </IntegrationCard>
  )
}

export function MollieKeySection() {
  const { t } = useTranslation('settings')
  return (
    <SecretKeySection
      integration="mollie"
      api={{ get: getMollieKey, set: setMollieKey, clear: clearMollieKey }}
      invalidCode="invalid_mollie_key"
      logoLight="/share/mollie/Mollie-Logo-Black-2023.png"
      logoDark="/share/mollie/Mollie-Logo-White-2023.png"
      alt="Mollie"
      copy={{
        title: t($ => $.mollie.title),
        description: t($ => $.mollie.description),
        label: t($ => $.mollie.label),
        placeholder: t($ => $.mollie.placeholder),
        helper: t($ => $.mollie.helper),
        invalidFormat: t($ => $.mollie.invalidFormat),
        saveFailed: t($ => $.mollie.saveFailed),
        replace: t($ => $.mollie.replace),
        remove: t($ => $.mollie.remove),
      }}
      mt={2}
    />
  )
}

export function ResendKeySection() {
  const { t } = useTranslation('settings')
  return (
    <SecretKeySection
      integration="resend"
      api={{ get: getResendKey, set: setResendKey, clear: clearResendKey }}
      invalidCode="invalid_resend_key"
      logoLight="/share/resend/resend-wordmark-light-256px.png"
      logoDark="/share/resend/resend-wordmark-dark-256px.png"
      alt="Resend"
      copy={{
        title: t($ => $.resend.title),
        description: t($ => $.resend.description),
        label: t($ => $.resend.label),
        placeholder: t($ => $.resend.placeholder),
        helper: t($ => $.resend.helper),
        invalidFormat: t($ => $.resend.invalidFormat),
        saveFailed: t($ => $.resend.saveFailed),
        replace: t($ => $.resend.replace),
        remove: t($ => $.resend.remove),
      }}
      mt={3}
    />
  )
}

interface BandsintownArtistIdBlockProps {
  artistId: string
  savedArtistId: string | null
  saving: boolean
  error: string | null
  onChange: (value: string) => void
  onSave: () => void
  onClear: () => void
}

function BandsintownArtistIdBlock({ artistId, savedArtistId, saving, error, onChange, onSave, onClear }: Readonly<BandsintownArtistIdBlockProps>) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t($ => $.bandsintown.artistId.label)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        {t($ => $.bandsintown.artistId.description)}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          size="small"
          fullWidth
          value={artistId}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t($ => $.bandsintown.artistId.placeholder)}
          error={!!error}
          helperText={error || t($ => $.bandsintown.artistId.helper)}
          autoComplete="off"
          slotProps={{ htmlInput: { spellCheck: false, inputMode: 'numeric' } }}
        />
        <Button
          variant="outlined"
          size="small"
          onClick={onSave}
          disabled={saving || !artistId.trim() || artistId.trim() === savedArtistId}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : null}
        >
          {t($ => $.actions.save, { ns: 'common' })}
        </Button>
        {savedArtistId && (
          <Tooltip title={t($ => $.bandsintown.artistId.remove)}>
            <span>
              <IconButton size="small" color="error" onClick={onClear} disabled={saving}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Stack>
    </Box>
  )
}

// Bandsintown API key (app_id) — same encrypted per-tenant credential storage
// as the Mollie key — plus the artist ID. Both are required before the artist
// fetch and the gig import can call the API.
function BandsintownKeySection() {
  const { t } = useTranslation(['settings', 'common'])
  const { setIntegrationConfigured } = useProfile()
  const [status, setStatus] = useState<MollieKeyStatus | null>(null)
  const [editing, setEditing] = useState(false)
  const [inputKey, setInputKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [artistId, setArtistIdInput] = useState('')
  const [savedArtistId, setSavedArtistId] = useState<string | null>(null)
  const [artistIdSaving, setArtistIdSaving] = useState(false)
  const [artistIdError, setArtistIdError] = useState<string | null>(null)

  useEffect(() => {
    getBandsintownKey().then((s) => setStatus(s as unknown as MollieKeyStatus)).catch(() => {})
    getBandsintownArtistId().then((a) => {
      setSavedArtistId(a.artistId ?? null)
      setArtistIdInput(a.artistId ?? '')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (status === null) return
    setIntegrationConfigured('bandsintown', Boolean(status.isSet && savedArtistId))
  }, [savedArtistId, setIntegrationConfigured, status])

  async function handleSaveArtistId() {
    const trimmed = artistId.trim()
    if (!trimmed) return
    setArtistIdSaving(true)
    setArtistIdError(null)
    try {
      const result = await setBandsintownArtistId(trimmed)
      setSavedArtistId(result.artistId ?? null)
      setArtistIdInput(result.artistId ?? '')
    } catch (err: unknown) {
      setArtistIdError(err instanceof Error && err.message === 'invalid_bandsintown_artist_id'
        ? t($ => $.bandsintown.artistId.invalidFormat)
        : t($ => $.bandsintown.artistId.saveFailed))
    } finally {
      setArtistIdSaving(false)
    }
  }

  async function handleClearArtistId() {
    setArtistIdSaving(true)
    setArtistIdError(null)
    try {
      await clearBandsintownArtistId()
      setSavedArtistId(null)
      setArtistIdInput('')
    } finally {
      setArtistIdSaving(false)
    }
  }

  function startEditing() {
    setInputKey('')
    setShowKey(false)
    setError(null)
    setEditing(true)
  }

  async function handleSave() {
    if (!inputKey.trim()) return
    setSaving(true)
    setError(null)
    try {
      const result = await setBandsintownKey(inputKey.trim())
      setStatus(result as unknown as MollieKeyStatus)
      setEditing(false)
      setInputKey('')
    } catch (err: unknown) {
      setError(err instanceof Error && err.message === 'invalid_bandsintown_key'
        ? t($ => $.bandsintown.invalidFormat)
        : t($ => $.bandsintown.saveFailed))
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    try {
      const result = await clearBandsintownKey()
      setStatus(result as unknown as MollieKeyStatus)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <IntegrationCard
      logoLight="/share/bit/01_BIT_Logo_OverLite.png"
      logoDark="/share/bit/01_BIT_Logo_OverDark.png"
      alt="Bandsintown"
      title={t($ => $.bandsintown.title)}
      description={t($ => $.bandsintown.description)}
      configured={!!status?.isSet || !!savedArtistId}
      mt={2}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t($ => $.bandsintown.label)}
      </Typography>
      {editing ? (
        <Stack spacing={1.5}>
          <TextField
            label={t($ => $.bandsintown.label)}
            fullWidth
            size="small"
            value={inputKey}
            onChange={(e) => { setInputKey(e.target.value); setError(null) }}
            type={showKey ? 'text' : 'password'}
            placeholder={t($ => $.bandsintown.placeholder)}
            error={!!error}
            helperText={error || t($ => $.bandsintown.helper)}
            autoComplete="off"
            slotProps={{
              htmlInput: { spellCheck: false },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => setShowKey((v) => !v)}
                      edge="end"
                      aria-label={showKey ? t($ => $.integrations.hideKey) : t($ => $.integrations.showKey)}
                    >
                      {showKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="small"
              onClick={handleSave}
              disabled={!inputKey.trim() || saving}
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : null}
            >
              {t($ => $.actions.save, { ns: 'common' })}
            </Button>
            <Button size="small" onClick={() => { setEditing(false); setInputKey(''); setError(null) }} disabled={saving}>
              {t($ => $.actions.cancel, { ns: 'common' })}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <KeyStatusDisplay status={status} />
          </Box>
          <Button size="small" variant="outlined" onClick={startEditing} disabled={saving}>
            {status?.isSet ? t($ => $.bandsintown.replace) : t($ => $.integrations.configure)}
          </Button>
          {status?.isSet && (
            <Tooltip title={t($ => $.bandsintown.remove)}>
              <span>
                <IconButton size="small" color="error" onClick={handleClear} disabled={saving}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      )}
      <BandsintownArtistIdBlock
        artistId={artistId}
        savedArtistId={savedArtistId}
        saving={artistIdSaving}
        error={artistIdError}
        onChange={(value) => { setArtistIdInput(value); setArtistIdError(null) }}
        onSave={handleSaveArtistId}
        onClear={handleClearArtistId}
      />
    </IntegrationCard>
  )
}
