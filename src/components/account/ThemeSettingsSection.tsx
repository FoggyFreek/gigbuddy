import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import CheckIcon from '@mui/icons-material/Check'
import { useProfile } from '../../contexts/profileContext.ts'
import { useThemeMode } from '../../contexts/themeModeContext.ts'
import { useCompactLayout } from '../../hooks/useCompactLayout.ts'
import { VARIANT_TOKENS } from '../../theme.ts'
import type { ThemeVariant } from '../../theme.ts'

const THEME_VARIANT_IDS: ThemeVariant[] = ['default', 'warm', 'slate']

export default function ThemeSettingsSection() {
  const { t } = useTranslation('notifications')
  const { mode, variant, setVariant } = useThemeMode()
  const { accentColor } = useProfile()
  const primary = accentColor || '#6750A4'
  const compact = useCompactLayout()

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
        {t($ => $.settings.theme.title)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t($ => $.settings.theme.description)}
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
                borderRadius: compact ? 1 : 2,
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
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block' }}>
                  {t($ => $.settings.theme.variants[id].label)}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {t($ => $.settings.theme.variants[id].description)}
                </Typography>
              </Box>
            </Box>
          )
        })}
      </Box>
    </Paper>
  )
}
