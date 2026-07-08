import { useEffect, useState, type ReactNode } from 'react'
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
import { clearMollieKey, getMollieKey, setMollieKey, clearBandsintownKey, getBandsintownKey, setBandsintownKey, clearShopifySecret, getShopifySecret, setShopifySecret, getShopifyClientId, setShopifyClientId, clearShopifyClientId, getShopifyDomain, setShopifyDomain } from '../../api/profile.ts'
import Divider from '@mui/material/Divider'

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

  return (
     <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.integrations.title)}
        </Typography>
        <PremiumDiamond feature="integrations" />
      </Stack>
      <MollieKeySection />
      <ShopifyKeySection />
      <BandsintownKeySection />
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
      <Box sx={{ p: compact ? 1.5 : 3, mt:2 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1, display: 'flex' }}>{logo}</Box>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setManuallyExpanded(true)}>
            {t($ => $.integrations.add)}
          </Button>
        </Stack>
      </Box>
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

function ShopifyKeySection() {
  const { t } = useTranslation(['settings', 'common'])
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

  let secretStatusNode: ReactNode
  if (status === null) {
    secretStatusNode = <CircularProgress size={18} />
  } else if (status.isSet) {
    secretStatusNode = (
      <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
        {t($ => $.integrations.configured)}
      </Typography>
    )
  } else {
    secretStatusNode = <Typography variant="body2" color="text.disabled">{t($ => $.integrations.notConfigured)}</Typography>
  }

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
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t($ => $.shopify.clientId.label)}
      </Typography>
      {clientIdEditing ? (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          <TextField
            label={t($ => $.shopify.clientId.label)}
            fullWidth
            size="small"
            value={clientId}
            onChange={(e) => { setClientIdInput(e.target.value); setClientIdError(null) }}
            placeholder={t($ => $.shopify.clientId.placeholder)}
            error={!!clientIdError}
            helperText={clientIdError || t($ => $.shopify.clientId.helper)}
            autoComplete="off"
            slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'none' } }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="small"
              onClick={handleSaveClientId}
              disabled={!clientId.trim() || clientIdSaving}
              startIcon={clientIdSaving ? <CircularProgress size={14} color="inherit" /> : null}
            >
              {t($ => $.actions.save, { ns: 'common' })}
            </Button>
            <Button size="small" onClick={cancelEditingClientId} disabled={clientIdSaving}>
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
          <Button size="small" variant="outlined" onClick={startEditingClientId} disabled={clientIdSaving}>
            {savedClientId ? t($ => $.shopify.clientId.replace) : t($ => $.integrations.configure)}
          </Button>
          {savedClientId && (
            <Tooltip title={t($ => $.shopify.clientId.remove)}>
              <span>
                <IconButton size="small" color="error" onClick={handleClearClientId} disabled={clientIdSaving}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      )}

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
            onChange={(e) => { setInputKey(e.target.value); setError(null) }}
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
            <Button size="small" onClick={cancelEditing} disabled={saving}>
              {t($ => $.actions.cancel, { ns: 'common' })}
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>
            {secretStatusNode}
          </Box>
          <Button size="small" variant="outlined" onClick={startEditing} disabled={saving}>
            {status?.isSet ? t($ => $.shopify.secret.replace) : t($ => $.integrations.configure)}
          </Button>
          {status?.isSet && (
            <Tooltip title={t($ => $.shopify.secret.remove)}>
              <span>
                <IconButton size="small" color="error" onClick={handleClear} disabled={saving}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      )}

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
            onChange={(e) => { setDomainInput(e.target.value); setDomainError(null) }}
            placeholder={t($ => $.shopify.domain.placeholder)}
            error={!!domainError}
            helperText={domainError || undefined}
            autoComplete="off"
            slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'none' } }}
          />
          <Button
            variant="outlined"
            size="small"
            onClick={handleSaveDomain}
            disabled={domainSaving || !domain.trim() || domain.trim() === savedDomain}
            startIcon={domainSaving ? <CircularProgress size={14} color="inherit" /> : null}
          >
            {t($ => $.actions.save, { ns: 'common' })}
          </Button>
        </Stack>
      </Box>
    </IntegrationCard>
  )
}

interface MollieKeyStatus {
  isSet?: boolean
  changedAt?: string | null
}

function MollieKeyStatusDisplay({ status }: Readonly<{ status: MollieKeyStatus | null }>) {
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

interface MollieKeyEditorProps {
  inputKey: string
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  showKey?: boolean
  onToggleShowKey: () => void
  error?: string | null
  saving?: boolean
  onSave: () => void
  onCancel: () => void
}

function MollieKeyEditor({ inputKey, onInputChange, showKey, onToggleShowKey, error, saving, onSave, onCancel }: Readonly<MollieKeyEditorProps>) {
  const { t } = useTranslation(['settings', 'common'])
  return (
    <Stack spacing={1.5}>
      <TextField
        label={t($ => $.mollie.label)}
        fullWidth
        size="small"
        value={inputKey}
        onChange={onInputChange}
        type={showKey ? 'text' : 'password'}
        placeholder={t($ => $.mollie.placeholder)}
        error={!!error}
        helperText={error || t($ => $.mollie.helper)}
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

function MollieKeySection() {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<MollieKeyStatus | null>(null)
  const [editing, setEditing] = useState(false)
  const [inputKey, setInputKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getMollieKey().then((s) => setStatus(s as unknown as MollieKeyStatus)).catch(() => {})
  }, [])

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
      const result = await setMollieKey(inputKey.trim())
      setStatus(result as unknown as MollieKeyStatus)
      setEditing(false)
      setInputKey('')
    } catch (err: unknown) {
      setError(err instanceof Error && err.message === 'invalid_mollie_key'
        ? t($ => $.mollie.invalidFormat)
        : t($ => $.mollie.saveFailed))
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    try {
      const result = await clearMollieKey()
      setStatus(result as unknown as MollieKeyStatus)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <IntegrationCard
      logoLight="/share/mollie/Mollie-Logo-Black-2023.png"
      logoDark="/share/mollie/Mollie-Logo-White-2023.png"
      alt="Mollie"
      title={t($ => $.mollie.title)}
      description={t($ => $.mollie.description)}
      configured={!!status?.isSet}
      mt={3}
    >
      {editing ? (
        <MollieKeyEditor
          inputKey={inputKey}
          onInputChange={(e) => { setInputKey(e.target.value); setError(null) }}
          showKey={showKey}
          onToggleShowKey={() => setShowKey((v) => !v)}
          error={error}
          saving={saving}
          onSave={handleSave}
          onCancel={cancelEditing}
        />
      ) : (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <MollieKeyStatusDisplay status={status} />
          </Box>
          <Button size="small" variant="outlined" onClick={startEditing} disabled={saving}>
            {status?.isSet ? t($ => $.mollie.replace) : t($ => $.integrations.configure)}
          </Button>
          {status?.isSet && (
            <Tooltip title={t($ => $.mollie.remove)}>
              <span>
                <IconButton size="small" color="error" onClick={handleClear} disabled={saving}>
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

// Bandsintown API key (app_id) — same encrypted per-tenant credential storage
// as the Mollie key; used by the artist/socials fetch and the gig import.
function BandsintownKeySection() {
  const { t } = useTranslation(['settings', 'common'])
  const [status, setStatus] = useState<MollieKeyStatus | null>(null)
  const [editing, setEditing] = useState(false)
  const [inputKey, setInputKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getBandsintownKey().then((s) => setStatus(s as unknown as MollieKeyStatus)).catch(() => {})
  }, [])

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
      configured={!!status?.isSet}
      mt={2}
    >
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
            <MollieKeyStatusDisplay status={status} />
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
    </IntegrationCard>
  )
}
