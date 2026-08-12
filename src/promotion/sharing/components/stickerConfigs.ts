export type StickerId = 'just-announced' | 'coming-up' | 'new'

export interface StickerConfig {
  lines: string[]
  sizes: number[]
}

export const STICKER_CONFIGS: Record<StickerId, StickerConfig> = {
  'just-announced': { lines: ['JUST', 'ANNOUNCED!'], sizes: [48, 38] },
  'coming-up': { lines: ['COMING', 'UP!'], sizes: [50, 50] },
  'new': { lines: ['NEW!'], sizes: [60] },
}
