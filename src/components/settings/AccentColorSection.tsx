import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import PremiumDiamond from '../PremiumDiamond.tsx'
import { useProfile } from '../../contexts/profileContext.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { updateProfile } from '../../api/profile.ts'

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

export default function AccentColorSection() {
  const { t } = useTranslation('settings')
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
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t($ => $.accentColor.title)}
        </Typography>
        <PremiumDiamond feature="customization" />
      </Stack>
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
  )
}
