import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import { VARIANT_TOKENS } from '../theme.ts'
import type { ThemeVariant } from '../theme.ts'
import { clearMollieKey, getMollieKey, setMollieKey, clearShopifySecret, getShopifySecret, setShopifySecret, getShopifyClientId, setShopifyClientId, clearShopifyClientId, getShopifyDomain, setShopifyDomain, updateProfile } from '../api/profile.ts'
import { getMyStorageStats, refreshMyStorageStats } from '../api/statistics.ts'
import { formatBytes } from '../utils/formatBytes.ts'
import ChartOfAccountsSection from '../components/settings/ChartOfAccountsSection.tsx'
import AccountingSettingsSection from '../components/settings/AccountingSettingsSection.tsx'

const PRESET_COLORS = [
  { hex: '#6750A4', label: 'Purple (default)' },
  { hex: '#1565C0', label: 'Blue' },
  { hex: '#0277BD', label: 'Light Blue' },
  { hex: '#00838F', label: 'Teal' },
  { hex: '#2E7D32', label: 'Green' },
  { hex: '#558B2F', label: 'Olive' },
  { hex: '#F57F17', label: 'Amber' },
  { hex: '#E65100', label: 'Deep Orange' },
  { hex: '#C62828', label: 'Red' },
  { hex: '#AD1457', label: 'Pink' },
  { hex: '#6A1B9A', label: 'Deep Purple' },
  { hex: '#4527A0', label: 'Indigo' },
]

const DEFAULT_COLOR = '#6750A4'

export default function TenantSettingsPage() {
  const { user } = useAuth()
  const isAdmin = user?.isSuperAdmin || user?.activeTenantRole === 'tenant_admin'
  const { accentColor, setAccentColor } = useProfile()
  const [saving, setSaving] = useState(false)
  const colorInputRef = useRef<HTMLInputElement>(null)

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
    <Box sx={{ maxWidth: 600, mx: 'auto', p: 3 }}>
      <Typography variant="h5" gutterBottom>
        Settings
      </Typography>

      <ThemeVariantSection />

      <Paper variant="outlined" sx={{ p: 3, mt: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
          Accent color
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose the primary color used throughout the app for this band.
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
          {PRESET_COLORS.map(({ hex, label }) => {
            const isActive = current.toLowerCase() === hex.toLowerCase()
            return (
              <Tooltip key={hex} title={label} placement="top">
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

          <Tooltip title="Custom color" placement="top">
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
            Reset to default
          </Button>
        )}
      </Paper>

      {isAdmin && <StorageUsageSection />}
      {isAdmin && (
        <>
          <Typography variant="h6" sx={{ mt: 4, mb: 0 }}>
            Integrations
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

const THEME_VARIANT_OPTIONS: Array<{ id: ThemeVariant; label: string; description: string }> = [
  { id: 'default', label: 'Default',  description: 'Material 3 violet' },
  { id: 'warm',    label: 'Warm',     description: 'Sand & earth tones' },
  { id: 'slate',   label: 'Slate',    description: 'Cool blue-grey' },
]

function ThemeVariantSection() {
  const { mode, variant, setVariant } = useThemeMode()
  const { accentColor } = useProfile()
  const primary = accentColor || '#6750A4'

  return (
    <Paper variant="outlined" sx={{ p: 3, mt: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }} gutterBottom>
        Theme
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Choose the surface style for this device. Your accent color still applies within each theme.
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {THEME_VARIANT_OPTIONS.map(({ id, label, description }) => {
          const tokens = VARIANT_TOKENS[id][mode === 'dark' ? 'dark' : 'light']
          const isActive = variant === id
          return (
            <Box
              key={id}
              component="button"
              onClick={() => setVariant(id)}
              sx={{
                width: 132,
                border: '2px solid',
                borderColor: isActive ? primary : 'divider',
                borderRadius: 2,
                overflow: 'hidden',
                cursor: 'pointer',
                p: 0,
                bgcolor: 'transparent',
                textAlign: 'left',
                transition: 'transform 0.1s, border-color 0.15s',
                '&:hover': { transform: 'scale(1.03)' },
              }}
            >
              <Box sx={{ height: 80, bgcolor: tokens.bg, position: 'relative', p: 1.25 }}>
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
              <Box sx={{ px: 1.5, py: 1, bgcolor: tokens.paper }}>
                <Typography variant="caption" sx={{ color: 'text.secondary',fontWeight: 600, display: 'block' }}>
                  {label}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {description}
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
  const [stats, setStats] = useState<StorageStats | null>(null)
  const [refreshing, setRefreshing] = useState(false)

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
    <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <StorageIcon fontSize="small" color="primary" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600,  flexGrow: 1  }}>
          Storage used
        </Typography>
        <Tooltip title="Recompute now">
          <span>
            <IconButton
              size="small"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="recompute storage usage"
            >
              {refreshing ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Total size of this band&apos;s uploaded files (banners, attachments, photos, logos, invoices).
      </Typography>
      {stats === null ? (
        <CircularProgress size={18} />
      ) : (
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          {formatBytes(stats.storage_bytes ?? 0)}
          <Typography component="span" variant="body2" color="text.secondary">
            {' · '}{stats.object_count} {stats.object_count === 1 ? 'file' : 'files'}
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

function IntegrationCard({ logoLight, logoDark, alt, title, description, configured, mt = 2, children }: IntegrationCardProps) {
  const { mode } = useThemeMode()
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
      <Paper variant="outlined" sx={{ p: 3, mt }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1, display: 'flex' }}>{logo}</Box>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setManuallyExpanded(true)}>
            Add integration
          </Button>
        </Stack>
      </Paper>
    )
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, mt }}>
      <Stack direction="column" spacing={0.5} sx={{ mb: 0.5 }}>
        <Box sx={{ alignSelf: 'flex-start', display: 'flex' }}>{logo}</Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{description}</Typography>
      {children}
    </Paper>
  )
}

function shopifyKeyErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message === 'invalid_shopify_client_secret') {
    return 'Invalid secret format. The app secret starts with "shpss_" followed by 32 hexadecimal characters.'
  }
  return 'Failed to save the app secret. Please try again.'
}

interface ShopifyKeyStatus {
  isSet?: boolean
  preview?: string
}

function ShopifyKeySection() {
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
      setDomainError('Invalid domain. Use the form yourband.myshopify.com.')
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
      setClientIdError('Invalid Client ID. It is at least 32 hexadecimal characters.')
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
      setError(shopifyKeyErrorMessage(err))
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
        {status.preview}
      </Typography>
    )
  } else {
    secretStatusNode = <Typography variant="body2" color="text.disabled">Not configured</Typography>
  }

  return (
    <IntegrationCard
      logoLight="/share/shopify/shopify_logo_black.png"
      logoDark="/share/shopify/shopify_logo_white.png"
      alt="Shopify"
      title="Shopify app credentials"
      description="Connect your Shopify store to read orders and import them to merchandise. Enter your app's Client ID and secret (from the Shopify Dev Dashboard) and your store domain — a short-lived access token is fetched automatically when importing. The secret is stored securely and never shown in full after saving."
      configured={configured}
      mt={2}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        Client ID
      </Typography>
      {clientIdEditing ? (
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          <TextField
            label="Client ID"
            fullWidth
            size="small"
            value={clientId}
            onChange={(e) => { setClientIdInput(e.target.value); setClientIdError(null) }}
            placeholder="32-character app Client ID"
            error={!!clientIdError}
            helperText={clientIdError || 'Your app\'s Client ID from the Shopify Dev Dashboard.'}
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
              Save
            </Button>
            <Button size="small" onClick={cancelEditingClientId} disabled={clientIdSaving}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 3 }}>
          <Box sx={{ flex: 1 }}>
            {savedClientId ? (
              <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                {savedClientId}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.disabled">Not configured</Typography>
            )}
          </Box>
          <Button size="small" variant="outlined" onClick={startEditingClientId} disabled={clientIdSaving}>
            {savedClientId ? 'Replace ID' : 'Configure'}
          </Button>
          {savedClientId && (
            <Tooltip title="Remove Client ID">
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
        App secret
      </Typography>
      {editing ? (
        <Stack spacing={1.5}>
          <TextField
            label="App secret"
            fullWidth
            size="small"
            value={inputKey}
            onChange={(e) => { setInputKey(e.target.value); setError(null) }}
            type={showKey ? 'text' : 'password'}
            placeholder="shpss_…"
            error={!!error}
            helperText={error || 'Paste your app\'s client secret from the Shopify Dev Dashboard.'}
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
                      aria-label={showKey ? 'Hide key' : 'Show key'}
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
              Save
            </Button>
            <Button size="small" onClick={cancelEditing} disabled={saving}>
              Cancel
            </Button>
          </Stack>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>
            {secretStatusNode}
          </Box>
          <Button size="small" variant="outlined" onClick={startEditing} disabled={saving}>
            {status?.isSet ? 'Replace secret' : 'Configure'}
          </Button>
          {status?.isSet && (
            <Tooltip title="Remove secret">
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
          Store domain
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Your myshopify.com domain — required to read orders for import.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            size="small"
            fullWidth
            value={domain}
            onChange={(e) => { setDomainInput(e.target.value); setDomainError(null) }}
            placeholder="yourband.myshopify.com"
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
            Save
          </Button>
        </Stack>
      </Box>
    </IntegrationCard>
  )
}

function mollieKeyErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message === 'invalid_mollie_key') {
    return 'Invalid key format. Keys must start with live_ or test_ followed by at least 25 alphanumeric characters.'
  }
  return 'Failed to save key. Please try again.'
}

interface MollieKeyStatus {
  isSet?: boolean
  preview?: string
}

function MollieKeyStatusDisplay({ status }: { status: MollieKeyStatus | null }) {
  if (status === null) return <CircularProgress size={18} />
  if (status.isSet) {
    return (
      <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
        {status.preview}
      </Typography>
    )
  }
  return <Typography variant="body2" color="text.disabled">Not configured</Typography>
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

function MollieKeyEditor({ inputKey, onInputChange, showKey, onToggleShowKey, error, saving, onSave, onCancel }: MollieKeyEditorProps) {
  return (
    <Stack spacing={1.5}>
      <TextField
        label="Mollie API key"
        fullWidth
        size="small"
        value={inputKey}
        onChange={onInputChange}
        type={showKey ? 'text' : 'password'}
        placeholder="live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        error={!!error}
        helperText={error || 'Paste your live or test key from the Mollie dashboard.'}
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
                  aria-label={showKey ? 'Hide key' : 'Show key'}
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
          Save
        </Button>
        <Button size="small" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </Stack>
    </Stack>
  )
}

function MollieKeySection() {
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
      setError(mollieKeyErrorMessage(err))
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
      title="Mollie API key"
      description="Used to create payment links via Mollie. The key is stored securely and never shown in full after saving."
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
            {status?.isSet ? 'Replace key' : 'Configure'}
          </Button>
          {status?.isSet && (
            <Tooltip title="Remove key">
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
