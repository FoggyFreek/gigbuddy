import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
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
import CheckIcon from '@mui/icons-material/Check'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import KeyIcon from '@mui/icons-material/Key'
import RefreshIcon from '@mui/icons-material/Refresh'
import StorageIcon from '@mui/icons-material/Storage'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { useAuth } from '../contexts/authContext.js'
import { useProfile } from '../contexts/profileContext.js'
import { clearMollieKey, getMollieKey, setMollieKey, updateProfile } from '../api/profile.js'
import { getMyStorageStats, refreshMyStorageStats } from '../api/statistics.js'
import { formatBytes } from '../utils/formatBytes.js'
import ChartOfAccountsSection from '../components/settings/ChartOfAccountsSection.jsx'
import AccountingSettingsSection from '../components/settings/AccountingSettingsSection.jsx'

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
  const colorInputRef = useRef(null)

  const current = accentColor || DEFAULT_COLOR

  async function applyColor(hex) {
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

      <Paper variant="outlined" sx={{ p: 3, mt: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
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
              +
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
      {isAdmin && <MollieKeySection />}
      {isAdmin && <ChartOfAccountsSection />}
      {isAdmin && <AccountingSettingsSection />}
    </Box>
  )
}

function StorageUsageSection() {
  const [stats, setStats] = useState(null) // { storage_bytes, object_count } | null
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    getMyStorageStats().then(setStats).catch(() => {})
  }, [])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      setStats(await refreshMyStorageStats())
    } catch {
      // best-effort; leave the previous value in place
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <StorageIcon fontSize="small" color="action" />
        <Typography variant="subtitle1" fontWeight={600} sx={{ flexGrow: 1 }}>
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
        <Typography variant="body1" fontWeight={600}>
          {formatBytes(stats.storage_bytes)}
          <Typography component="span" variant="body2" color="text.secondary">
            {' · '}{stats.object_count} {stats.object_count === 1 ? 'file' : 'files'}
          </Typography>
        </Typography>
      )}
    </Paper>
  )
}

function mollieKeyErrorMessage(err) {
  if (err.message === 'invalid_mollie_key') {
    return 'Invalid key format. Keys must start with live_ or test_ followed by at least 25 alphanumeric characters.'
  }
  return 'Failed to save key. Please try again.'
}

function MollieKeyStatusDisplay({ status }) {
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

MollieKeyStatusDisplay.propTypes = {
  status: PropTypes.shape({ isSet: PropTypes.bool, preview: PropTypes.string }),
}

function MollieKeyEditor({ inputKey, onInputChange, showKey, onToggleShowKey, error, saving, onSave, onCancel }) {
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
        inputProps={{ spellCheck: false }}
        InputProps={{
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

MollieKeyEditor.propTypes = {
  inputKey: PropTypes.string.isRequired,
  onInputChange: PropTypes.func.isRequired,
  showKey: PropTypes.bool,
  onToggleShowKey: PropTypes.func.isRequired,
  error: PropTypes.string,
  saving: PropTypes.bool,
  onSave: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
}

function MollieKeySection() {
  const [status, setStatus] = useState(null) // { isSet, preview }
  const [editing, setEditing] = useState(false)
  const [inputKey, setInputKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getMollieKey().then(setStatus).catch(() => {})
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
      setStatus(result)
      setEditing(false)
      setInputKey('')
    } catch (err) {
      setError(mollieKeyErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    setSaving(true)
    try {
      const result = await clearMollieKey()
      setStatus(result)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <KeyIcon fontSize="small" color="action" />
        <Typography variant="subtitle1" fontWeight={600}>
          Mollie API key
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Used to process payments via Mollie. The key is stored securely and never shown in full after saving.
      </Typography>

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
    </Paper>
  )
}
