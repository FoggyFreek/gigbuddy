import type { ThemeMode } from '../contexts/themeModeContext.ts'
import { getBackgroundMeta, type BackgroundMeta } from './backgroundMeta.ts'

// Background images live in /public/backgrounds as bg_NN_<mode>.webp, with a
// separate set per theme mode. Bump the matching count when you add files,
// and add a matching entry in backgroundMeta.ts.
const BACKGROUND_COUNTS: Record<ThemeMode, number> = { light: 5, dark: 5 }

export interface RandomBackground {
  image: string
  position: string
  id: string
  meta: BackgroundMeta
}

// Pick a random background image (for the active theme mode) plus a random crop
// position. `cover` scaling already adapts to the viewport (compact vs.
// desktop); randomizing backgroundPosition picks a different slice when the
// image overflows. Impure by design — call it from a state initializer or an
// event/effect, never in a render body.
export function pickRandomBackground(mode: ThemeMode): RandomBackground {
  const n = Math.floor(Math.random() * BACKGROUND_COUNTS[mode]) + 1
  const x = Math.floor(Math.random() * 101)
  const y = Math.floor(Math.random() * 101)
  const id = `bg_${String(n).padStart(2, '0')}_${mode}`
  return {
    image: `url(/backgrounds/${id}.webp)`,
    position: `${x}% ${y}%`,
    id,
    meta: getBackgroundMeta(id),
  }
}
