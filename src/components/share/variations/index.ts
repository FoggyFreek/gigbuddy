// Canonical prop set passed to every Square/Story layout:
// { gig, photoSrc, pan, zoom, accent, socials, sticker, stickerPosition,
//   logoSrc, bannerSrc, bandName, showLogo }
// Each layout destructures only the subset it uses.

import type { ComponentType } from 'react'
// These JSX layout files are not yet converted; their exports are typed as `any`.
// We cast to ComponentType<Record<string, unknown>> here rather than widening in
// every call site — safe because the actual runtime prop sets are a superset.
import { Square as VintageSquare, Story as VintageStory } from './vintage.tsx'
import { Square as MinimalSquare, Story as MinimalStory } from './minimal.tsx'
import { Square as PhotoSquare, Story as PhotoStory } from './photo.tsx'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LayoutComponent = ComponentType<any>

export interface VariationSupports {
  accent: boolean
  pan: boolean
  zoom: boolean
  sticker: boolean
  socials: boolean
  banner: boolean
  toggleLogo: boolean
}

export interface ShareVariation {
  id: string
  label: string
  supports: VariationSupports
  Square: LayoutComponent
  Story: LayoutComponent
}

export const SHARE_VARIATIONS: ShareVariation[] = [
  {
    id: 'vintage',
    label: 'Vintage',
    supports: { accent: true, pan: true, zoom: true, sticker: true, socials: true, banner: true, toggleLogo: false },
    Square: VintageSquare,
    Story: VintageStory,
  },
  {
    id: 'minimal',
    label: 'Minimal',
    supports: { accent: true, pan: true, zoom: false, sticker: true, socials: true, banner: true, toggleLogo: false },
    Square: MinimalSquare,
    Story: MinimalStory,
  },
  {
    id: 'photo',
    label: 'Photo',
    supports: { accent: true, pan: true, zoom: true, sticker: true, socials: false, banner: false, toggleLogo: true },
    Square: PhotoSquare,
    Story: PhotoStory,
  },
]

export const SHARE_VARIATION_MAP: Record<string, ShareVariation> = Object.fromEntries(
  SHARE_VARIATIONS.map((v) => [v.id, v]),
)
