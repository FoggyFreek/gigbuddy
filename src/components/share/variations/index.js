// Canonical prop set passed to every Square/Story layout:
// { gig, photoSrc, pan, zoom, accent, socials, sticker, stickerPosition,
//   logoSrc, bannerSrc, bandName, showLogo, invertLogo }
// Each layout destructures only the subset it uses.

import { Square as VintageSquare, Story as VintageStory } from './vintage.jsx'
import { Square as MinimalSquare, Story as MinimalStory } from './minimal.jsx'
import { Square as PhotoSquare, Story as PhotoStory } from './photo.jsx'

export const SHARE_VARIATIONS = [
  {
    id: 'vintage',
    label: 'Vintage',
    supports: { accent: true, pan: true, zoom: true, sticker: true, socials: true, banner: true, toggleLogo: false, invertLogo: true },
    Square: VintageSquare,
    Story: VintageStory,
  },
  {
    id: 'minimal',
    label: 'Minimal',
    supports: { accent: true, pan: true, zoom: false, sticker: true, socials: true, banner: true, toggleLogo: false, invertLogo: true },
    Square: MinimalSquare,
    Story: MinimalStory,
  },
  {
    id: 'photo',
    label: 'Photo',
    supports: { accent: true, pan: true, zoom: true, sticker: true, socials: false, banner: false, toggleLogo: true, invertLogo: true },
    Square: PhotoSquare,
    Story: PhotoStory,
  },
]

export const SHARE_VARIATION_MAP = Object.fromEntries(
  SHARE_VARIATIONS.map((v) => [v.id, v]),
)
