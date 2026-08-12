import type { SxProps, Theme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import PauseCircleFilledRounded from '@mui/icons-material/PauseCircleFilledRounded'
import PlayCircleFilledRounded from '@mui/icons-material/PlayCircleFilledRounded'
import VolumeOffRounded from '@mui/icons-material/VolumeOffRounded'
import VolumeUpRounded from '@mui/icons-material/VolumeUpRounded'
import H5AudioPlayer, { RHAP_UI } from 'react-h5-audio-player'
import { useCompactLayout } from '../../../hooks/useCompactLayout.ts'
import 'react-h5-audio-player/lib/styles.css'

// The vendor stylesheet hardcodes a light-theme look (white card, grey bars), so
// every visible surface is rebound to palette tokens. Descendant selectors under
// the sx class outrank the library's single-class rules.
const playerSx: SxProps<Theme> = {
  '& .rhap_container': {
    p: 0,
    bgcolor: 'transparent',
    boxShadow: 'none',
    fontFamily: 'inherit',
  },
  '& .rhap_time': { color: 'text.secondary', fontSize: 12 },
  '& .rhap_progress-container': { mx: 1 },
  '& .rhap_progress-bar': { bgcolor: 'action.selected' },
  '& .rhap_download-progress': { bgcolor: 'action.disabledBackground' },
  '& .rhap_progress-filled, & .rhap_volume-filled': { bgcolor: 'primary.main' },
  '& .rhap_progress-indicator, & .rhap_volume-indicator': {
    background: (theme) => theme.palette.primary.main,
    boxShadow: 'none',
  },
  '& .rhap_progress-indicator': { width: 12, height: 12, ml: '-6px', top: '-4px' },
  '& .rhap_main-controls-button, & .rhap_volume-button': { color: 'primary.main' },
  '& .rhap_play-pause-button': { fontSize: 34, width: 34, height: 34 },
  '& .rhap_volume-button': { fontSize: 20, width: 20, height: 20, flex: '0 0 20px' },
  '& .rhap_volume-container': { flex: '0 1 70px' },
}

interface AudioFilePlayerProps {
  src: string
  /** File name — distinguishes several players on one page for screen readers. */
  label?: string
}

export default function AudioFilePlayer({ src, label }: Readonly<AudioFilePlayerProps>) {
  const { t } = useTranslation('common')
  const isCompact = useCompactLayout()

  return (
    <Box sx={playerSx}>
      <H5AudioPlayer
        src={src}
        layout="horizontal"
        preload="metadata"
        showJumpControls={false}
        // No room for a volume slider on a phone, where the hardware buttons own
        // volume anyway (iOS ignores the audio element's volume outright).
        customControlsSection={
          isCompact
            ? [RHAP_UI.MAIN_CONTROLS]
            : [RHAP_UI.MAIN_CONTROLS, RHAP_UI.VOLUME_CONTROLS]
        }
        // Icons come from the app's MUI set: the library's defaults are Iconify
        // names it would fetch from api.iconify.design at render time.
        customIcons={{
          play: <PlayCircleFilledRounded fontSize="inherit" />,
          pause: <PauseCircleFilledRounded fontSize="inherit" />,
          volume: <VolumeUpRounded fontSize="inherit" />,
          volumeMute: <VolumeOffRounded fontSize="inherit" />,
        }}
        i18nAriaLabels={{
          ...H5AudioPlayer.defaultI18nAriaLabels,
          player: label
            ? t($ => $.audioPlayer.playerFor, { name: label })
            : t($ => $.audioPlayer.player),
          progressControl: t($ => $.audioPlayer.progressControl),
          volumeControl: t($ => $.audioPlayer.volumeControl),
          play: t($ => $.audioPlayer.play),
          pause: t($ => $.audioPlayer.pause),
          volume: t($ => $.audioPlayer.volume),
          volumeMute: t($ => $.audioPlayer.volumeMute),
        }}
      />
    </Box>
  )
}
