import { useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import { useProfile } from '../contexts/profileContext.js'
import { updateProfile } from '../api/profile.js'

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
    </Box>
  )
}
