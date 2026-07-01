import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import CheckIcon from '@mui/icons-material/Check'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import StorageIcon from '@mui/icons-material/Storage'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { useAuth } from '../contexts/authContext.ts'
import { useProfile } from '../contexts/profileContext.ts'
import { useThemeMode } from '../contexts/themeModeContext.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import { VARIANT_TOKENS } from '../theme.ts'
import type { ThemeVariant } from '../theme.ts'
import { clearMollieKey, getMollieKey, setMollieKey, clearShopifySecret, getShopifySecret, setShopifySecret, getShopifyClientId, setShopifyClientId, clearShopifyClientId, getShopifyDomain, setShopifyDomain, updateProfile } from '../api/profile.ts'
import { getMyStorageStats, refreshMyStorageStats } from '../api/statistics.ts'
import { formatBytes } from '../utils/formatBytes.ts'
import ChartOfAccountsSection from '../components/settings/ChartOfAccountsSection.tsx'
import AccountingSettingsSection from '../components/settings/AccountingSettingsSection.tsx'

// `label` keys the i18n preset names under settings.accentColor.presets.
const PRESET_COLORS = [
  { hex: '#6750A4', label: 'purple' },
  { hex: '#1565C0', label: 'blue' },
  { hex: '#0277BD', label: 'lightBlue' },
  { hex: '#00838F', label: 'teal' },
  { hex: '#2E7D32', label: 'green' },
  { hex: '#558B2F', label: 'olive' },
  { hex: '#F57F17', label: 'amber' },
  { hex: '#E65100', label: 'deepOrange' },
  { hex: '#C62828', label: 'red' },
  { hex: '#AD1457', label: 'pink' },
  { hex: '#6A1B9A', label: 'deepPurple' },
  { hex: '#4527A0', label: 'indigo' },
] as const

const DEFAULT_COLOR = '#6750A4'

// Shopify client ids aren't secret but are long; collapse the middle so the
// display value doesn't eat the card's horizontal space.
function shortenClientId(value: string): string {
  if (value.length <= 14) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export default function TenantSettingsPage() {
  const { t } = useTranslation('settings')
  const { user } = useAuth()
  const isAdmin = user?.isSuperAdmin || user?.activeTenantRole === 'tenant_admin'
  const { accentColor, setAccentColor } = useProfile()
  const [saving, setSaving] = useState(false)
  const colorInputRef = useRef<HTMLInputElement>(null)
  const compact = useCompactLayout()

  const current = accentColor || DEFAULT_COLOR

  async function applyColor(hex: string) {
    if (hex === current) return
    setSaving(true)
    try {
      await updateProfile({ accent_color: hex === DEFAULT_COLOR ? null : hex })
      setAccentColor(hex === DEFAULT_COLOR ? null : hex)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: compact ? 0.5 : 1 }}>
      <Typography variant="h5" gutterBottom>
        {t($ => $.title)}
      </Typography>

      <ThemeVariantSection />

      <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3, mt: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
          {t($ => $.accentColor.title)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t($ => $.accentColor.description)}
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
          {PRESET_COLORS.map(({ hex, label }) => {
            const isActive = current.toLowerCase() === hex.toLowerCase()
            return (
              <Tooltip key={hex} title={t($ => $.accentColor.presets[label])} placement="top">
                <Box
                  component="button"
                  onClick={() => applyColor(hex)}
                  disabled={saving}
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    border: isActive ? '3px solid' : '2px solid transparent',
                    borderColor: isActive ? 'text.primary' : 'transparent',
                    bgcolor: hex,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    outline: 'none',
                    p: 0,
                    transition: 'transform 0.1s',
                    '&:hover': { transform: 'scale(1.15)' },
                    '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
                  }}
                >
                  {isActive && (
                    <CheckIcon sx={{ color: '#fff', fontSize: 18, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.5))' }} />
                  )}
                </Box>
              </Tooltip>
            )
          })}

          <Tooltip title={t($ => $.accentColor.custom)} placement="top">
            <Box
              component="button"
              onClick={() => colorInputRef.current?.click()}
              disabled={saving}
              sx={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                border: '2px dashed',
                borderColor: 'divider',
                bgcolor: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                outline: 'none',
                p: 0,
                fontSize: 20,
                color: 'text.secondary',
                transition: 'transform 0.1s',
                '&:hover': { transform: 'scale(1.15)' },
                '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
              }}
            >
              <span>+</span>
              <input
                ref={colorInputRef}
                type="color"
                defaultValue={current}
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                onChange={(e) => applyColor(e.target.value)}
              />
            </Box>
          </Tooltip>
        </Box>

        {accentColor && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => applyColor(DEFAULT_COLOR)}
            disabled={saving}
          >
            {t($ => $.accentColor.reset)}
          </Button>
        )}
      </Paper>

      {isAdmin && <StorageUsageSection />}
      {isAdmin && (
        <>
          <Typography variant="h6" sx={{ mt: 4, mb: 0 }}>
            {t($ => $.integrations.title)}
          </Typography>
          <MollieKeySection />
          <ShopifyKeySection />
        </>
      )}
      {isAdmin && <ChartOfAccountsSection />}
      {isAdmin && <AccountingSettingsSection />}
    </Box>
  )
}

const THEME_VARIANT_IDS: ThemeVariant[] = ['default', 'warm', 'slate']

function ThemeVariantSection() {
  const { t } = useTranslation('settings')
  const { mode, variant, setVariant } = useThemeMode()
  const { accentColor } = useProfile()
  const primary = accentColor || '#6750A4'
  const compact = useCompactLayout()

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3, mt: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
        {t($ => $.theme.title)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t($ => $.theme.description)}
      </Typography>
      <Box sx={{ display: 'flex', gap: compact ? 1 : 2, flexWrap: 'wrap' }}>
        {THEME_VARIANT_IDS.map((id) => {
          const tokens = VARIANT_TOKENS[id][mode === 'dark' ? 'dark' : 'light']
          const isActive = variant === id
          return (
            <Box
              key={id}
              component="button"
              onClick={() => setVariant(id)}
              sx={{
                width: compact ? 92 : 132,
                border: '2px solid',
                borderColor: isActive ? primary : 'divider',
                borderRadius: compact ? 1:2,
                overflow: 'hidden',
                cursor: 'pointer',
                p: 0,
                bgcolor: 'transparent',
                textAlign: 'left',
                transition: 'transform 0.1s, border-color 0.15s',
                '&:hover': { transform: 'scale(1.03)' },
              }}
            >
              <Box sx={{ height: compact ? 56 : 80, bgcolor: tokens.bg, position: 'relative', p: compact ? 0.75 : 1.25 }}>
                <Box
                  sx={{
                    bgcolor: tokens.paper,
                    borderRadius: 1,
                    height: '100%',
                    p: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.75,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                  }}
                >
                  <Box sx={{ width: '58%', height: 6, borderRadius: 0.5, bgcolor: primary }} />
                  <Box sx={{ width: '80%', height: 4, borderRadius: 0.5, bgcolor: tokens.secondary, opacity: 0.45 }} />
                  <Box sx={{ width: '48%', height: 4, borderRadius: 0.5, bgcolor: tokens.secondary, opacity: 0.25 }} />
                </Box>
                {isActive && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      bgcolor: primary,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CheckIcon sx={{ color: '#fff', fontSize: 13 }} />
                  </Box>
                )}
              </Box>
              <Box sx={{ px: compact ? 1 : 1.5, py: compact ? 0.5 : 1, bgcolor: tokens.paper }}>
                <Typography variant="caption" sx={{ color: 'text.secondary',fontWeight: 600, display: 'block' }}>
                  {t($ => $.theme.variants[id].label)}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {t($ => $.theme.variants[id].description)}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Paper>
  )
}

interface StorageStats {
  storage_bytes?: number
  object_count?: number
}

function StorageUsageSection() {
  const { t } = useTranslation('settings')
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const compact = useCompactLayout()

  useEffect(() => {
    getMyStorageStats().then((s) => setStats(s as unknown as StorageStats)).catch(() => {})
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      setStats(await refreshMyStorageStats() as unknown as StorageStats)
    } catch {
      // best-effort; leave the previous value in place
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3, mt: 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <StorageIcon fontSize="small" color="primary" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600,  flexGrow: 1  }}>
          {t($ => $.storage.title)}
        </Typography>
        <Tooltip title={t($ => $.storage.recompute)}>
          <span>
            <IconButton
              size="small"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label={t($ => $.storage.recomputeAria)}
            >
              {refreshing ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t($ => $.storage.description)}
      </Typography>
      {stats === null ? (
        <CircularProgress size={18} />
      ) : (
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          {formatBytes(stats.storage_bytes ?? 0)}
          <Typography component="span" variant="body2" color="text.secondary">
            {' · '}{t($ => $.storage.fileCount, { count: stats.object_count ?? 0 })}
          </Typography>
        </Typography>
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
