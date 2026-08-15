import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Fade from '@mui/material/Fade'
import { useThemeMode } from '../../../../contexts/themeModeContext.ts'
import { pickRandomBackground } from '../../../../utils/randomBackground.ts'
import BackgroundAttribution from '../../../../components/shared/BackgroundAttribution.tsx'
import type { BackgroundMeta } from '../../../../utils/backgroundMeta.ts'

const FADE_MS = 700

interface Layer {
  id: number
  image: string
  position: string
  meta: BackgroundMeta
}

// Decorative full-bleed backdrop for the onboarding wizard: a random picture
// per step, crossfaded on every step change. The outgoing layer stays mounted
// underneath the incoming one until the fade finishes, so the transition never
// flashes the empty page background.
// The layer's own sequence id and pickRandomBackground's bg_NN id both happen
// to be called `id`; keep this local so a spread can't clobber the sequence one.
function toLayer(id: number, mode: Parameters<typeof pickRandomBackground>[0]): Layer {
  const { image, position, meta } = pickRandomBackground(mode)
  return { id, image, position, meta }
}

export default function OnboardingBackground({ step }: Readonly<{ step: number }>) {
  const { mode } = useThemeMode()
  const [layers, setLayers] = useState<Layer[]>(() => [toLayer(0, mode)])
  const nextId = useRef(1)
  // The theme mode has its own image set, so a mode flip re-picks as a step does.
  const pickKey = `${mode}:${step}`
  const prevPickKey = useRef(pickKey)

  useEffect(() => {
    if (prevPickKey.current === pickKey) return
    prevPickKey.current = pickKey
    const id = nextId.current
    nextId.current += 1
    // Carry at most one outgoing layer: stepping faster than the fade replaces
    // the pending picture rather than stacking a third.
    setLayers((prev) => [...prev.slice(-1), toLayer(id, mode)])
  }, [pickKey, mode])

  // Drop everything the layer that just landed has covered — but never a layer
  // newer than it, which a quick next step may already have queued.
  const handleEntered = useCallback((id: number) => {
    setLayers((prev) => prev.filter((layer) => layer.id >= id))
  }, [])

  return (
    <Box
      aria-hidden
      sx={{ position: 'fixed', inset: 0, zIndex: 0, bgcolor: 'background.default' }}
    >
      {layers.map((layer) => (
        <Fade key={layer.id} in appear timeout={FADE_MS} onEntered={() => handleEntered(layer.id)}>
          <Box
            data-testid="onboarding-background-layer"
            sx={{
              position: 'absolute',
              inset: 0,
              backgroundImage: layer.image,
              backgroundSize: 'cover',
              backgroundPosition: layer.position,
              backgroundRepeat: 'no-repeat',
            }}
          />
        </Fade>
      ))}
      <BackgroundAttribution meta={layers[layers.length - 1].meta} />
    </Box>
  )
}
