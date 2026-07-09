import Box from '@mui/material/Box'
import { useTranslation } from 'react-i18next'
import { useThemeMode } from '../../contexts/themeModeContext.ts'

interface CheersBadgeProps {
  cheers: number
  size?: number
}

/**
 * The cheers value of an achievement: the number above a pair of clapping
 * hands — the dark icon in light mode, the light icon in dark mode.
 */
export default function CheersBadge({ cheers, size = 40 }: Readonly<CheersBadgeProps>) {
  const { t } = useTranslation('achievements')
  const { mode } = useThemeMode()
  return (
    <Box
      role="img"
      aria-label={t($ => $.cheersAria, { count: cheers })}
      sx={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        flexShrink: 0,
        width: size,
        color: mode === 'dark' ? 'common.white' : 'common.black',
        lineHeight: 1,
      }}
    >
      <Box component="span" sx={{ fontWeight: 700, fontSize: size * 0.42, mr: '20px' }}>
        {cheers}
      </Box>
      <Box
        component="img"
        src={mode === 'dark' ? '/icons/clap_light.png' : '/icons/clap_dark.png'}
        alt=""
        aria-hidden="true"
        sx={{ width: size, height: 'auto', mr: '20px', display: 'block' }}
      />
    </Box>
  )
}
